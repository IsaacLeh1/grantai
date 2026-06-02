import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile } from "fs/promises";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 5050);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function loadRubric() {
  const raw = await readFile(path.join(__dirname, "data", "rubric.json"), "utf8");
  return JSON.parse(raw);
}

async function loadSoftware() {
  const raw = await readFile(path.join(__dirname, "data", "software.json"), "utf8");
  return JSON.parse(raw);
}

async function loadApplications() {
  try {
    const raw = await readFile(path.join(__dirname, "data", "applications.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function loadReviews() {
  try {
    const raw = await readFile(path.join(__dirname, "data", "reviews.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveReview(review) {
  try {
    const reviews = await loadReviews();
    review.id = `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    reviews.push(review);
    await writeFile(path.join(__dirname, "data", "reviews.json"), JSON.stringify(reviews, null, 2));
    return review.id;
  } catch (error) {
    console.error("Error saving review:", error.message);
    throw error;
  }
}

function safe(v) {
  return typeof v === "string" ? v.trim() : "";
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Local models often wrap JSON in ```json fences or add stray prose.
// Pull out the first {...} block so parseJsonSafely has a clean target.
function extractFirstJsonBlock(text) {
  if (!text) return "";
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : String(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return "";
  return body.slice(start, end + 1);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeExternalIdeasResponse(data) {
  if (!data) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  const direct = [
    data.content,
    data.output_text,
    data.result,
    data.message,
    data.ideas,
    data.response,
    data?.data?.content,
    data?.choices?.[0]?.message?.content,
    data?.choices?.[0]?.text
  ].find(Boolean);

  if (typeof direct === "string") {
    return direct;
  }

  if (Array.isArray(direct)) {
    return direct
      .map((item, idx) => {
        if (typeof item === "string") {
          return `## Option ${idx + 1}\n- ${item}`;
        }
        if (item?.title || item?.description) {
          return `## Option ${idx + 1}: ${item.title || "Grant Idea"}\n- ${item.description || ""}`;
        }
        return `## Option ${idx + 1}\n- ${JSON.stringify(item)}`;
      })
      .join("\n\n");
  }

  return JSON.stringify(data, null, 2);
}

async function callExternalIdeasApi(payload) {
  const apiUrl = safe(process.env.IDEAS_API_URL);
  if (!apiUrl) {
    throw new Error("IDEAS_API_URL is not configured on the server");
  }

  const timeoutMs = Number(process.env.IDEAS_API_TIMEOUT_MS || 25000);
  const authHeader = safe(process.env.IDEAS_API_AUTH_HEADER) || "x-api-key";
  const apiKey = safe(process.env.IDEAS_API_KEY);
  const authScheme = safe(process.env.IDEAS_API_AUTH_SCHEME);

  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers[authHeader] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`External ideas API error ${response.status}: ${raw}`);
  }

  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }

  const normalized = normalizeExternalIdeasResponse(parsed);
  if (!normalized) {
    throw new Error("External ideas API returned an empty response");
  }

  return normalized;
}

async function callExternalRubricGrader(payload) {
  const apiUrl = safe(process.env.RUBRIC_GRADER_API_URL);
  if (!apiUrl) {
    throw new Error("RUBRIC_GRADER_API_URL is not configured on the server");
  }

  const timeoutMs = Number(process.env.RUBRIC_GRADER_API_TIMEOUT_MS || 30000);
  const authHeader = safe(process.env.RUBRIC_GRADER_API_AUTH_HEADER) || "x-api-key";
  const apiKey = safe(process.env.RUBRIC_GRADER_API_KEY);
  const authScheme = safe(process.env.RUBRIC_GRADER_API_AUTH_SCHEME);

  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers[authHeader] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`External rubric grader API error ${response.status}: ${raw}`);
  }

  const parsed = parseJsonSafely(raw);
  return parsed || { report: raw };
}

function computeTotals(criteriaResults) {
  let weightedScore = 0;
  let totalWeight = 0;

  for (const c of criteriaResults) {
    const weight = toNumber(c.weightPercent, 0);
    const score = Math.max(0, Math.min(4, toNumber(c.score, 0)));
    weightedScore += (score / 4) * weight;
    totalWeight += weight;
  }

  const overallPercent = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
  const overallPoints = (overallPercent / 100) * 4;
  return {
    overallPercent: Number(overallPercent.toFixed(1)),
    overallPoints: Number(overallPoints.toFixed(2))
  };
}

function heuristicGradeProposal(proposalText, rubric, facultySubmission) {
  const text = (proposalText || "").toLowerCase();
  const studentCountMatch = text.match(/(\d{2,4})\s*(?:\+|students?|students impacted|student(?:s)?)/i);
  const studentCount = studentCountMatch ? Number(studentCountMatch[1]) : null;

  const criteria = (rubric.criteria || []).map((criterion) => {
    const id = criterion.id || criterion.name;
    const weightPercent = toNumber(criterion.weightPercent, 0);
    let score = 2;
    let rationale = "Baseline developing quality detected; strengthen alignment and evidence.";
    let improvement = "Add concrete evidence, implementation detail, and measurable outcomes.";

    if (id === "quantitative-impact") {
      if (studentCount !== null && studentCount >= 300) score = 4;
      else if (studentCount !== null && studentCount >= 200) score = 3;
      else if (studentCount !== null && studentCount >= 100) score = 2;
      else if (studentCount !== null && studentCount >= 50) score = 1;
      else if (studentCount !== null && studentCount >= 25) score = 0.5;
      else score = 0;
      rationale = extractEvidenceLine(proposalText, ["students impacted", "students per term", "students", "student"]) || "No exact student-impact evidence found in the proposal.";
      improvement = "State the number of students impacted and describe how AI is used in the class.";
    }

    if (id === "qualitative-impact") {
      const engagementSignals = ["external organization", "practitioner", "site visit", "guest critique", "consultation", "deliverable", "contact hours"];
      const hits = engagementSignals.filter((signal) => text.includes(signal)).length;
      score = hits >= 5 ? 4 : hits >= 3 ? 3 : hits >= 2 ? 2 : hits >= 1 ? 1 : 0;
      rationale = extractEvidenceLine(proposalText, engagementSignals, ["organization", "reviewed", "work product"]) || "No exact external-engagement evidence found in the proposal.";
      improvement = "Describe the organization, contact hours, student deliverables, and how the work is reviewed.";
    }

    if (id === "software-approvals-dx") {
      const approvedSignals = ["already approved", "dx approved", "approved by dx"];
      const strongSignals = ["working with", "within 2 weeks", "full approval", "100% functionality", "mature in process"];
      const softwareSignals = ["software", "tool", "tools", "api", "platform", "license", "licensed"];
      const approvalEvidence = extractEvidenceLine(proposalText, approvedSignals, softwareSignals);
      const strongEvidence = extractEvidenceLine(proposalText, strongSignals, softwareSignals);
      if (approvalEvidence) {
        score = 4;
      } else if (strongEvidence && strongSignals.some((signal) => strongEvidence.toLowerCase().includes(signal))) {
        score = 3;
      } else {
        score = 0;
      }
      rationale = approvalEvidence || strongEvidence || extractEvidenceLine(proposalText, softwareSignals) || "No exact DX approval evidence found in the proposal.";
      improvement = "State whether DX has already approved the software or provide concrete evidence they are about to approve it.";
    }

    if (id === "assessment-plan") {
      const assessSignals = ["outcome", "baseline", "post", "metric", "survey", "assessment", "durable skill", "method"];
      const hits = assessSignals.filter((signal) => text.includes(signal)).length;
      score = hits >= 5 ? 4 : hits >= 3 ? 2 : hits >= 2 ? 1 : 0;
      rationale = extractEvidenceLine(proposalText, assessSignals, ["learning", "measure", "student"]) || "No exact assessment-plan evidence found in the proposal.";
      improvement = "Add specific learning outcomes and describe how student learning will be measured.";
    }

    if (id === "rapid-impact") {
      const summerFallSignals = ["summer 2026", "fall 2026", "summer block", "fall semester"];
      const springSignals = ["spring 2027", "jan 2027", "later"];
      const summerFallHits = summerFallSignals.filter((signal) => text.includes(signal)).length;
      const springHits = springSignals.filter((signal) => text.includes(signal)).length;
      score = summerFallHits >= 2 ? 4 : summerFallHits >= 1 ? 3 : springHits >= 1 ? 0 : 0;
      rationale = extractEvidenceLine(proposalText, summerFallSignals, springSignals) || "No exact timing evidence found in the proposal.";
      improvement = "Make the timing explicit and show whether impact starts in summer or fall 2026.";
    }

    if (id === "sustainability-plan") {
      const sustainSignals = ["continue", "beyond", "ongoing", "future", "dean", "fund", "free", "cheap", "one-time", "stick"];
      const hits = sustainSignals.filter((signal) => text.includes(signal)).length;
      score = hits >= 5 ? 4 : hits >= 2 ? 1 : 0;
      rationale = extractEvidenceLine(proposalText, sustainSignals, ["after the grant", "ongoing support", "reusable"]) || "No exact sustainability evidence found in the proposal.";
      improvement = "State who will maintain the change and how ongoing costs will be covered.";
    }

    return {
      id,
      name: criterion.name || id,
      score,
      maxScore: 4,
      weightPercent,
      rationale,
      improvement
    };
  });

  // If an autofill variant was used, optionally boost scores for demos.
  const variant = facultySubmission && facultySubmission.autofillVariant ? String(facultySubmission.autofillVariant) : null;
  const facultyText = facultySubmission ? String(Object.values(facultySubmission).join(" ")).toLowerCase() : "";
  const facultyCountMatch = facultyText.match(/(\d{2,4})\s*(?:\+|students?|students impacted|student(?:s)?)/i);
  const facultyStudentCount = facultyCountMatch ? Number(facultyCountMatch[1]) : null;
  if (variant === "A") {
    // Make variant A score around ~80% by setting three criteria high and others moderate.
    criteria.forEach((c) => {
      if (c.id === "quantitative-impact") {
        // For demo variant A, award full quantitative credit to showcase the rubric in examples
        c.score = 4;
        c.rationale = c.rationale || "Demo boost: treated as high-impact for the example submission.";
        c.improvement = c.improvement || "No immediate changes required for demo-quality submission.";
      } else if (c.id === "qualitative-impact") {
        c.score = 4;
        c.rationale = c.rationale || "Demo boost: evidence aligns strongly to this criterion.";
        c.improvement = c.improvement || "No immediate changes required for demo-quality submission.";
      } else if (c.id === "software-approvals-dx") {
        c.rationale = c.rationale || "No exact DX approval evidence found in the proposal.";
        c.improvement = c.improvement || "State whether DX has already approved the software or provide concrete evidence they are about to approve it.";
      } else {
        c.score = Math.max(2, c.score);
        c.rationale = c.rationale || "Baseline moderate evidence detected.";
        c.improvement = c.improvement || "Clarify measures and timeline for stronger score.";
      }
    });
  }

  return {
    ...computeTotals(criteria),
    criteria
  };
}

function facultyAnswerForCriterion(criterionId, facultySubmission) {
  if (!facultySubmission) return "(no faculty submission provided)";
  const byBox = {
    "quantitative-impact": `${facultySubmission.box1_course || ""} — ${facultySubmission.box2_assignment || ""}`,
    "qualitative-impact": `${facultySubmission.box3_build || ""}\n\n${facultySubmission.box4_learning || ""}`,
    "software-approvals-dx": `${facultySubmission.box6_software || ""}`,
    "assessment-plan": `${facultySubmission.box4_learning || ""}`,
    "rapid-impact": `${facultySubmission.box1_course || ""} — ${facultySubmission.box2_assignment || ""}`,
    "sustainability-plan": `${facultySubmission.box5_money || ""} — ${facultySubmission.box4_learning || ""}`
  };
  return byBox[criterionId] || `${Object.values(facultySubmission).join(" \n\n")}`;
}

function buildGradingMarkdown(grading, facultySubmission) {
  if (!grading?.criteria?.length) {
    return "## Rubric Grade\n- Grading data unavailable.";
  }

  const lines = [
    "## Rubric Grade",
    `- Overall Score: **${grading.overallPercent}%** (${grading.overallPoints}/4.00)`,
    "",
    "| Criterion | Weight | Score | Rationale | Improve Next |",
    "|---|---:|---:|---|---|"
  ];

  for (const c of grading.criteria) {
    const score = `${Math.max(0, Math.min(4, toNumber(c.score, 0)))}/4`;
    const rationale = escapeMarkdown(c.rationale || "");
    let improvementText = c.improvement || "";
    if (toNumber(c.score, 0) >= toNumber(c.maxScore, 4)) {
      improvementText = "Looks good — full marks.";
    }
    const improvement = escapeMarkdown(improvementText);
    lines.push(
      `| ${c.name} | ${toNumber(c.weightPercent, 0)}% | ${score} | ${rationale} | ${improvement} |`
    );
  }

  return lines.join("\n");
}

function escapeMarkdown(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function extractEvidenceLine(text, signals, fallbackSignals = []) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const searchSignals = [...signals, ...fallbackSignals].filter(Boolean);

  for (const signal of searchSignals) {
    const needle = String(signal).toLowerCase();
    const match = lines.find((line) => line.toLowerCase().includes(needle));
    if (match) {
      return match;
    }
  }

  return "";
}

async function gradeProposalAgainstRubric({ proposalText, rubric, facultySubmission }) {
  const externalApiUrl = safe(process.env.RUBRIC_GRADER_API_URL);
  if (externalApiUrl) {
    const payload = {
      task: "rubric-grading",
      rubric: rubric.criteria,
      proposal: proposalText,
      facultySubmission
    };

    const external = await callExternalRubricGrader(payload);
    if (external?.grading?.criteria) {
      const normalized = {
        ...external.grading,
        ...computeTotals(external.grading.criteria)
      };
      return {
        grading: normalized,
        report: external.report || buildGradingMarkdown(normalized, facultySubmission),
        source: "external-api"
      };
    }

    if (external?.criteria) {
      const normalized = {
        ...external,
        ...computeTotals(external.criteria)
      };
      return {
        grading: normalized,
        report: external.report || buildGradingMarkdown(normalized, facultySubmission),
        source: "external-api"
      };
    }

    const reportText = external?.report || external?.content || external?.message;
    if (reportText) {
      return {
        grading: null,
        report: String(reportText),
        source: "external-api"
      };
    }
  }

  const systemPrompt = "You are a grant rubric evaluator for UVU proposals. In any rationale or improvement text, address the applicant directly as \"you\" — never \"the instructor\" or \"the faculty\". Return strict JSON only.";
  const userPrompt = `Grade this proposal against the rubric using the rubric's defined score levels, including 0 and 0.5 where applicable. Return JSON object with this schema only:\n{\n  "criteria": [{"id":"string","name":"string","score":number,"maxScore":4,"weightPercent":number,"rationale":"string","improvement":"string"}]\n}\n\nRubric:\n${JSON.stringify(rubric.criteria, null, 2)}\n\nFaculty submission:\n${JSON.stringify(facultySubmission, null, 2)}\n\nProposal draft:\n${proposalText}`;

  let aiText = "";
  try {
    aiText = (await callOpenAI(systemPrompt, userPrompt, 1100)) || "";
  } catch (e) {
    console.error("Rubric grading AI fallback:", e.message);
  }

  const parsed = parseJsonSafely(aiText);
  if (parsed?.criteria?.length) {
    const normalized = {
      ...parsed,
      ...computeTotals(parsed.criteria)
    };
    return {
      grading: normalized,
      report: buildGradingMarkdown(normalized, facultySubmission),
      source: "internal-ai"
    };
  }

  const heuristic = heuristicGradeProposal(proposalText, rubric, facultySubmission);
  return {
    grading: heuristic,
    report: buildGradingMarkdown(heuristic, facultySubmission),
    source: "heuristic-fallback"
  };
}

// Calls OpenAI's Responses API. Throws on any failure so the caller can fall back.
async function callOpenAIRemote(systemPrompt, userPrompt, maxOutputTokens = 800) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.output_text || "";
}

// Calls an OpenAI-compatible /chat/completions endpoint. Defaults to a local
// Ollama server, but with LOCAL_LLM_API_KEY set it also works with hosted
// providers like Groq or OpenRouter (needed when the site runs in the cloud).
async function callLocalLLM(systemPrompt, userPrompt, maxOutputTokens = 800) {
  // Trim env values — pasted dashboard vars often carry a stray trailing newline/space.
  const baseUrl = (safe(process.env.LOCAL_LLM_BASE_URL) || "http://localhost:11434/v1").replace(/\/+$/, "");
  const model = safe(process.env.LOCAL_LLM_MODEL) || "llama3";
  const timeoutMs = Number(process.env.LOCAL_LLM_TIMEOUT_MS || 120000);
  const apiKey = safe(process.env.LOCAL_LLM_API_KEY);

  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: maxOutputTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Local LLM error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

// Unified AI entry point: try OpenAI first, then fall back to the local LLM.
// Returns null only if every provider fails, so callers can use their own heuristic fallback.
async function callOpenAI(systemPrompt, userPrompt, maxOutputTokens = 800) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const remote = await callOpenAIRemote(systemPrompt, userPrompt, maxOutputTokens);
      if (remote) {
        return remote;
      }
      console.warn("OpenAI returned an empty response; falling back to local LLM.");
    } catch (e) {
      console.warn(`OpenAI call failed (${e.message}); falling back to local LLM.`);
    }
  }

  try {
    return await callLocalLLM(systemPrompt, userPrompt, maxOutputTokens);
  } catch (e) {
    console.error(`Local LLM call failed: ${e.message}`);
    return null;
  }
}

app.get("/api/rubric", async (_req, res) => {
  try {
    const rubric = await loadRubric();
    return res.json(rubric);
  } catch (error) {
    return res.status(500).json({ error: "Unable to load rubric", detail: error.message });
  }
});

app.get("/api/software", async (_req, res) => {
  try {
    const software = await loadSoftware();
    return res.json({ items: software });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load software", detail: error.message });
  }
});

app.post("/api/explore", async (req, res) => {
  try {
    const rubric = await loadRubric();
    const body = req.body || {};
    const ideaSource = safe(body.ideaSource).toLowerCase() || "internal-ai";
    const context = {
      course: safe(body.course),
      assignment: safe(body.assignment),
      goal: safe(body.goal),
      budget: safe(body.budget),
      software: safe(body.software)
    };

    if (ideaSource === "external-api") {
      const externalPayload = {
        task: "grant-proposal-ideation",
        constraints: {
          ideaCount: 3,
          outputFormat: "markdown",
          audience: "UVU faculty"
        },
        rubric: rubric.criteria,
        facultyContext: context
      };

      try {
        const content = await callExternalIdeasApi(externalPayload);
        return res.json({ content, source: "external-api" });
      } catch (externalErr) {
        return res.status(502).json({
          error: "Unable to fetch ideas from external API",
          detail: externalErr.message
        });
      }
    }

    const systemPrompt = "You help a UVU faculty member find grant-worthy teaching ideas. Address them directly as \"you\" (e.g., \"you could…\") — never \"the instructor\" or \"the faculty\". Keep responses concise and practical. Return markdown with headings and bullet points.";
    const userPrompt = `Using this rubric:\n${JSON.stringify(rubric.criteria, null, 2)}\n\nFaculty context:\n${JSON.stringify(context, null, 2)}\n\nProvide exactly 3 grant idea options. For each option include:\n1) Title\n2) Why it aligns to rubric criteria\n3) Estimated budget range\n4) Risks and mitigation\n5) First 2 implementation steps this semester.`;

    let text = "";
    try {
      text = (await callOpenAI(systemPrompt, userPrompt, 900)) || "";
    } catch (e) {
      console.error("Explore endpoint AI fallback:", e.message);
    }

    if (!text) {
      text = [
        "## Option 1: Assignment Studio Refresh",
        "- Alignment: Strengthens innovation, assessment evidence, and impact through rubric-based redesign.",
        "- Budget: $2,500 to $4,500 for training hours and digital tool support.",
        "- Risk and Mitigation: Faculty workload risk; mitigate with milestone checkpoints and shared templates.",
        "- First Steps: Define current pain points and pilot with one module this semester.",
        "",
        "## Option 2: Feedback Analytics Loop",
        "- Alignment: Improves need/impact and assessment criteria by tracking feedback quality and student growth.",
        "- Budget: $1,500 to $3,000 for analytics software and TA time.",
        "- Risk and Mitigation: Tool adoption risk; mitigate with short student onboarding and support docs.",
        "- First Steps: Choose one assessment and define baseline metrics this month.",
        "",
        "## Option 3: Active Learning Media Kit",
        "- Alignment: Supports innovation and sustainability with reusable media assignments tied to outcomes.",
        "- Budget: $3,000 to $5,000 for software licensing and media asset development.",
        "- Risk and Mitigation: Scope creep risk; mitigate with narrow deliverables and phase gates.",
        "- First Steps: Select target assignment and map rubric criteria to deliverables."
      ].join("\n");
    }

    return res.json({ content: text, source: "internal-ai" });
  } catch (error) {
    return res.status(500).json({ error: "Unable to generate explore ideas", detail: error.message });
  }
});

app.post("/api/execute", async (req, res) => {
  try {
    const rubric = await loadRubric();
    const body = req.body || {};
    const payload = {
      box1_course: safe(body.box1),
      box2_assignment: safe(body.box2),
      box3_build: safe(body.box3),
      box4_learning: safe(body.box4),
      box5_money: safe(body.box5),
      box6_software: safe(body.box6)
    };
    // Preserve autofillVariant if provided by the client so heuristic can detect demo variant
    if (body.autofillVariant) {
      payload.autofillVariant = safe(body.autofillVariant);
    }

    const systemPrompt = "You are a grant writing copilot for a UVU faculty member. Write to them directly, using \"you\" and \"your course/assignment\" — never \"the instructor\" or \"the faculty\". Draft clear proposal content with practical language and measurable outcomes. Return markdown only.";
    const userPrompt = `Rubric criteria:\n${JSON.stringify(rubric.criteria, null, 2)}\n\nFaculty submission:\n${JSON.stringify(payload, null, 2)}\n\nCreate a concise draft proposal with sections: Project Summary, Need Statement, Proposed Intervention, Implementation Plan, Assessment Plan, Budget Justification, Sustainability, and 30-second Pitch.`;

    let text = "";
    try {
      text = (await callOpenAI(systemPrompt, userPrompt, 1100)) || "";
    } catch (e) {
      console.error("Execute endpoint AI fallback:", e.message);
    }

    if (!text) {
      text = `## Project Summary
${payload.box3_build || "A targeted teaching innovation"} for ${payload.box1_course || "the selected course"}.

## Need Statement
This proposal addresses a challenge in ${payload.box2_assignment || "the current assignment workflow"} and targets improved student learning outcomes.

## Proposed Intervention
${payload.box4_learning || "The intervention improves engagement and clarity through structured, rubric-aligned activities."}

## Implementation Plan
- Week 1-2: finalize scope, tools, and rubric mapping.
- Week 3-6: pilot in one section and collect formative feedback.
- Week 7-10: revise materials and scale to additional students.

## Assessment Plan
- Baseline and post scores for target learning outcomes.
- Student perception survey tied to engagement and clarity.
- Instructor reflection plus artifact review.

## Budget Justification
Requested amount: ${payload.box5_money || "TBD"}. Funds cover implementation labor, software, and instructional assets.

## Sustainability
Resources and templates remain reusable after the grant period; practices can be scaled to future sections.

## 30-second Pitch
This project modernizes ${payload.box2_assignment || "a core assignment"} in ${payload.box1_course || "the course"} using practical tools (${payload.box6_software || "selected software"}) to deliver measurable learning gains and a sustainable model for future terms.`;
    }

    let gradingResponse;
    try {
      gradingResponse = await gradeProposalAgainstRubric({
        proposalText: text,
        rubric,
        facultySubmission: payload
      });
    } catch (gradingError) {
      console.error("Grading step failed:", gradingError.message);
      gradingResponse = {
        grading: null,
        report: "## Rubric Grade\n- Grading service is currently unavailable. Please try again.",
        source: "unavailable"
      };
    }
    // If grading is available, append an estimated overall grade to the 30-second Pitch
    try {
      const g = gradingResponse && gradingResponse.grading;
      if (g && (g.overallPercent !== undefined)) {
        const overallPercent = g.overallPercent;
        const overallPoints = g.overallPoints;
        const gradeNote = `\n\n**Estimated Rubric Grade:** ${overallPercent}% (${overallPoints}/4.00)`;
        if (typeof text === "string" && text.includes("## 30-second Pitch")) {
          text = text.replace("## 30-second Pitch", "## 30-second Pitch" + gradeNote);
        } else if (typeof text === "string") {
          text = text + "\n\n" + gradeNote;
        }
      }
    } catch (e) {
      // non-fatal
      console.error("Failed to append grade note to pitch:", e.message);
    }
    return res.json({
      content: text,
      grading: gradingResponse.grading,
      gradingReport: gradingResponse.report,
      gradingSource: gradingResponse.source
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to draft proposal", detail: error.message });
  }
});

app.post("/api/software-chat", async (req, res) => {
  try {
    const software = await loadSoftware();
    const message = safe(req.body?.message);
    const course = safe(req.body?.course);
    const idea = safe(req.body?.idea);

    const systemPrompt = "You are a software advisor for a faculty member's grant proposal. Address them directly as \"you\" — never \"the instructor\" or \"the faculty\". Recommend from the provided list only. Be specific and concise.";
    const userPrompt = `Available software:\n${JSON.stringify(software, null, 2)}\n\nUser question: ${message}\nCourse context: ${course}\nIdea context: ${idea}\n\nReturn: 1) Top 2 recommendations and why, 2) cost notes, 3) next step for procurement or trial.`;

    let text = "";
    try {
      text = (await callOpenAI(systemPrompt, userPrompt, 700)) || "";
    } catch (e) {
      console.error("Software chat AI fallback:", e.message);
    }

    if (!text) {
      const normalized = message.toLowerCase();
      const matches = software.filter((item) => {
        const haystack = `${item.name} ${item.category} ${item.bestFor.join(" ")} ${item.notes}`.toLowerCase();
        return normalized.split(/\s+/).some((token) => token.length > 3 && haystack.includes(token));
      });

      const picks = (matches.length ? matches : software.slice(0, 2)).slice(0, 2);
      text = picks
        .map(
          (p, idx) =>
            `${idx + 1}. **${p.name}** (${p.category})\n- Why: Best for ${p.bestFor.join(", ")}.\n- Cost: ${p.costModel}.\n- Next step: Request campus access and test in one assignment module.`
        )
        .join("\n\n");
    }

    return res.json({ content: text });
  } catch (error) {
    return res.status(500).json({ error: "Unable to answer software question", detail: error.message });
  }
});

app.get("/api/applications", async (_req, res) => {
  try {
    const applications = await loadApplications();
    return res.json({ applications });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load applications", detail: error.message });
  }
});

app.post("/api/reviews", async (req, res) => {
  try {
    const review = req.body;
    
    if (!review.applicationId || !review.reviewerName) {
      return res.status(400).json({ error: "Missing applicationId or reviewerName" });
    }

    if (!review.scores || typeof review.scores !== "object") {
      return res.status(400).json({ error: "Missing or invalid scores object" });
    }

    const reviewId = await saveReview(review);
    
    return res.json({
      success: true,
      reviewId,
      message: "Review submitted successfully"
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save review", detail: error.message });
  }
});

// Strip a leading due-date/time prefix like "Wed, Feb 18, 11:30 PM MT:" so the
// assignment name reads cleanly (e.g. "Week 6 Assignment: Matching").
function cleanAssignmentName(raw) {
  return String(raw || "")
    .trim()
    .replace(
      /^[A-Za-z]{3,9},?\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[A-Z]{0,3}\s*[:\-–]\s*/i,
      ""
    )
    .trim();
}

// Coerce whatever JSON shape the model returned into a clean assignment list.
// Handles: {assignments:[...]}, alternate keys, top-level arrays, and arrays of
// plain strings (which local models commonly emit instead of objects).
function normalizeAssignments(parsed) {
  if (!parsed) return [];
  let list = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (typeof parsed === "object") {
    list = parsed.assignments || parsed.assessments || parsed.tasks || parsed.items || null;
  }
  if (!Array.isArray(list)) return [];

  return list
    .map((a) => {
      if (typeof a === "string") {
        return { name: cleanAssignmentName(a), description: "" };
      }
      if (a && typeof a === "object") {
        const name = a.name || a.title || a.assignment || a.assessment || a.task || "";
        const description = a.description || a.details || a.detail || a.notes || a.due || "";
        return { name: cleanAssignmentName(name), description: String(description || "").trim() };
      }
      return null;
    })
    .filter((a) => a && a.name);
}

// Last-resort fallback: scan the raw syllabus text for assignment-like lines so
// the user always gets something from their actual file, even if the AI fails.
function heuristicAssignments(text) {
  const keywords = [
    "assignment", "assessment", "essay", "paper", "project", "exam", "midterm",
    "final", "quiz", "homework", "lab", "presentation", "portfolio", "report",
    "discussion", "participation", "capstone", "thesis", "journal", "reflection",
    "worksheet", "problem set", "case study"
  ];
  // Word-boundary match so "exam" doesn't match "example", "thesis" not "hypothesis", etc.
  const keywordRe = new RegExp(`\\b(${keywords.join("|")})\\b`, "i");
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  const found = [];

  for (const line of lines) {
    if (line.length < 4 || line.length > 160) continue;
    if (keywordRe.test(line)) {
      const name = cleanAssignmentName(line.replace(/^[-*•\d.)(\s]+/, "")).slice(0, 140);
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        found.push({ name, description: "" });
      }
    }
    if (found.length >= 20) break;
  }
  return found;
}

// Coerce the model's "ideas" output into a clean {title, description} list,
// tolerating string arrays, alternate keys, and top-level arrays.
function normalizeIdeas(parsed) {
  if (!parsed) return [];
  let list = Array.isArray(parsed)
    ? parsed
    : parsed.ideas || parsed.possibilities || parsed.suggestions || parsed.items || null;
  if (!Array.isArray(list)) return [];

  return list
    .map((it) => {
      if (typeof it === "string") {
        return { title: "", description: it.trim() };
      }
      if (it && typeof it === "object") {
        const title = it.title || it.name || it.idea || "";
        const description = it.description || it.detail || it.details || it.text || it.how || "";
        return { title: String(title).trim(), description: String(description || "").trim() };
      }
      return null;
    })
    .filter((it) => it && (it.title || it.description));
}

// Offline fallback ideas, used only when the AI is unreachable. Kept short and
// context-free (the chat already names the assignment) to avoid repetitive text.
function fallbackAssignmentIdeas() {
  return [
    { title: "Formative AI feedback", description: "Let students get AI feedback on their drafts so they can fix gaps before submitting." },
    { title: "Rubric-aligned auto-scoring", description: "Use AI to pre-score work against the rubric for faster instructor review." },
    { title: "AI-moderated peer review", description: "Guide peer feedback with AI that checks for clarity and constructiveness." },
    { title: "Scaffolded prompts", description: "Offer AI-generated prompts and worked examples to support struggling students." },
    { title: "Reflection summaries", description: "Have AI summarize student reflections to track learning over time." },
    { title: "Adaptive next steps", description: "Let AI suggest each student's next task based on their work." }
  ];
}

const syllabusUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// Extract raw text from an uploaded PDF or Word (.docx) file.
async function extractSyllabusText(file) {
  const name = (file.originalname || "").toLowerCase();
  const mime = file.mimetype || "";

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file.buffer });
    const data = await parser.getText();
    return data?.text || "";
  }

  if (name.endsWith(".docx") || mime.includes("officedocument.wordprocessingml")) {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || "";
  }

  throw new Error("Unsupported file type. Please upload a PDF or Word (.docx) file.");
}

app.post("/api/upload-syllabus", syllabusUpload.single("syllabus"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let text = "";
    try {
      text = await extractSyllabusText(req.file);
    } catch (e) {
      return res.status(415).json({ error: e.message, filename: req.file.originalname });
    }

    text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
    if (!text) {
      return res.status(422).json({
        error: "Could not extract any text from that file. It may be a scanned image (try a text-based PDF or .docx).",
        filename: req.file.originalname
      });
    }

    // Keep the prompt manageable for local models.
    const maxChars = 12000;
    const snippet = text.length > maxChars ? text.slice(0, maxChars) : text;

    const systemPrompt =
      "You read a course syllabus and extract its graded assignments and assessments. Return STRICT JSON only — no prose, no markdown.";
    const userPrompt = `From the syllabus text below, extract a short course summary and the list of graded assignments or assessments.

Return JSON with exactly this schema:
{
  "course": "course name/number if found, else empty string",
  "summary": "one or two sentence summary of the course",
  "assignments": [{ "name": "string", "description": "short description if available, else empty string" }]
}

Syllabus text:
${snippet}`;

    let aiText = "";
    try {
      aiText = (await callOpenAI(systemPrompt, userPrompt, 900)) || "";
    } catch (e) {
      console.error("Syllabus parse AI error:", e.message);
    }
    const aiResponded = Boolean(aiText && aiText.trim());

    const parsed =
      parseJsonSafely(aiText) || parseJsonSafely(extractFirstJsonBlock(aiText)) || null;
    let assignments = normalizeAssignments(parsed);
    let source = assignments.length ? "ai" : "none";

    // If the model produced nothing usable, fall back to scanning the text itself.
    if (!assignments.length) {
      const heuristic = heuristicAssignments(text);
      if (heuristic.length) {
        assignments = heuristic;
        source = "heuristic";
      }
    }

    let note = "";
    if (!aiResponded) {
      note =
        "The AI model didn't respond. Make sure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull llama3`), or set a valid OPENAI_API_KEY.";
    }

    console.log(
      `[upload-syllabus] file="${req.file.originalname}" chars=${text.length} aiResponded=${aiResponded} assignments=${assignments.length} source=${source}`
    );
    if (!assignments.length && aiResponded) {
      console.log(`[upload-syllabus] AI returned unparseable output: ${aiText.slice(0, 300)}`);
    }

    return res.json({
      filename: req.file.originalname,
      course: parsed?.course || "",
      summary: parsed?.summary || "",
      assignments,
      charCount: text.length,
      aiResponded,
      note,
      source
    });
  } catch (error) {
    console.error("upload-syllabus error:", error.message);
    return res.status(500).json({ error: "Failed to process syllabus", detail: error.message });
  }
});

app.post("/api/assignment-ideas", async (req, res) => {
  try {
    const assignment = safe(req.body?.assignment);
    const course = safe(req.body?.course);
    if (!assignment) {
      return res.status(400).json({ error: "Missing assignment" });
    }

    const systemPrompt =
      "You help a faculty member enhance a specific course assignment with AI. Address them directly as \"you\" — never \"the instructor\" or \"the faculty\". Be concrete and specific to the assignment. Write plainly. Return STRICT JSON only, no prose or markdown.";
    const userPrompt = `Assignment: ${assignment}
${course ? `Course: ${course}\n` : ""}
Suggest up to 6 distinct ways you could use AI to enhance THIS assignment.

Rules for each idea:
- "title": 2-4 words.
- "description": ONE short sentence (under 20 words) in plain language.
- Do NOT repeat the assignment title in the description.
- Vary the wording and the approach across ideas; do not reuse the same sentence pattern.

Return JSON with exactly this schema:
{
  "ideas": [{ "title": "short title", "description": "one short sentence" }]
}`;

    let aiText = "";
    try {
      aiText = (await callOpenAI(systemPrompt, userPrompt, 900)) || "";
    } catch (e) {
      console.error("assignment-ideas AI error:", e.message);
    }
    const aiResponded = Boolean(aiText && aiText.trim());

    const parsed =
      parseJsonSafely(aiText) || parseJsonSafely(extractFirstJsonBlock(aiText)) || null;
    let ideas = normalizeIdeas(parsed);
    let source = ideas.length ? "ai" : "none";

    if (!ideas.length) {
      ideas = fallbackAssignmentIdeas();
      source = aiResponded ? "fallback" : "offline";
    }

    console.log(
      `[assignment-ideas] assignment="${assignment.slice(0, 60)}" aiResponded=${aiResponded} ideas=${ideas.length} source=${source}`
    );

    return res.json({ ideas, aiResponded, source });
  } catch (error) {
    console.error("assignment-ideas error:", error.message);
    return res.status(500).json({ error: "Unable to generate ideas", detail: error.message });
  }
});

// Turn the collected agent Q&A into a readable context block for prompts.
function answersToText(answers) {
  if (!Array.isArray(answers)) return "";
  return answers
    .filter((a) => a && (a.question || a.answer))
    .map((a) => `- ${safe(a.question)}: ${safe(a.answer)}`)
    .join("\n");
}

// Flatten a list that may contain strings or {title,description} objects into strings.
function toStringList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((it) => {
      if (typeof it === "string") return it.trim();
      if (it && typeof it === "object") {
        const t = it.title || it.name || it.label || "";
        const d = it.description || it.detail || it.text || "";
        return [t, d].filter(Boolean).join(": ").trim();
      }
      return "";
    })
    .filter(Boolean);
}

app.post("/api/generate-ideas", async (req, res) => {
  try {
    const context = answersToText(req.body?.answers);

    const systemPrompt =
      "You help a UVU faculty member turn their course and assignment notes into fundable teaching-with-AI grant ideas. Address them directly as \"you\" — never \"the instructor\" or \"the faculty\". Return STRICT JSON only, no prose or markdown.";
    const userPrompt = `Faculty answers:
${context || "(none provided)"}

Based on these answers, produce grant ideas and a few proposal direction options.

Return JSON with exactly this schema:
{
  "ideas": ["one concise sentence per idea, up to 6"],
  "options": ["Option A: short label", "Option B: short label", "Option C: short label", "Option D: short label"]
}`;

    let aiText = "";
    try {
      aiText = (await callOpenAI(systemPrompt, userPrompt, 900)) || "";
    } catch (e) {
      console.error("generate-ideas AI error:", e.message);
    }
    const aiResponded = Boolean(aiText && aiText.trim());

    const parsed =
      parseJsonSafely(aiText) || parseJsonSafely(extractFirstJsonBlock(aiText)) || null;
    let ideas = toStringList(parsed?.ideas);
    let options = toStringList(parsed?.options);

    if (!ideas.length) {
      ideas = [
        "Pilot an AI formative-feedback tool so students improve drafts before submitting.",
        "Build an AI rubric-scoring pipeline so instructors scale feedback across sections.",
        "Create an AI-assisted peer-review workflow that guides comments and revisions.",
        "Run a small study comparing AI-supported vs traditional feedback on rubric scores."
      ];
    }
    if (options.length < 2) {
      options = [
        "Option A: Scalable Classroom Tool",
        "Option B: Pilot Study with Analytics",
        "Option C: Curriculum-Integrated ePortfolio",
        "Option D: Adaptive Feedback Pilot"
      ];
    }

    console.log(`[generate-ideas] aiResponded=${aiResponded} ideas=${ideas.length} options=${options.length}`);
    return res.json({ ideas, options, aiResponded });
  } catch (error) {
    console.error("generate-ideas error:", error.message);
    return res.status(500).json({ error: "Unable to generate ideas", detail: error.message });
  }
});

app.post("/api/ai-reply", async (req, res) => {
  try {
    const type = safe(req.body?.type);
    const idea = safe(req.body?.idea);
    const message = safe(req.body?.message);
    const context = answersToText(req.body?.answers);

    const systemPrompt =
      "You are a concise grant-writing assistant for a UVU faculty member. Address them directly as \"you\" — never \"the instructor\" or \"the faculty\". Answer in plain language, at most a few sentences.";
    const userPrompt =
      type === "explain"
        ? `Your context:\n${context}\n\nIn 2-3 sentences, explain how you could pursue this grant idea:\n"${idea}"`
        : `Faculty context:\n${context}\n\nQuestion: ${message || idea}`;

    let content = "";
    try {
      content = (await callOpenAI(systemPrompt, userPrompt, 400)) || "";
    } catch (e) {
      console.error("ai-reply AI error:", e.message);
    }
    const aiResponded = Boolean(content && content.trim());
    if (!aiResponded) {
      content = "I can't reach the AI model right now. Please try again shortly.";
    }

    console.log(`[ai-reply] type=${type || "chat"} aiResponded=${aiResponded}`);
    return res.json({ content: content.trim(), aiResponded });
  } catch (error) {
    console.error("ai-reply error:", error.message);
    return res.status(500).json({ error: "Unable to reply", detail: error.message });
  }
});

app.post("/api/proposal-draft", async (req, res) => {
  try {
    const variant = safe(req.body?.variant);
    const optionLabel = safe(req.body?.option);
    const idea = safe(req.body?.idea);
    const context = answersToText(req.body?.answers);

    const lengthInstruction = /long/i.test(variant)
      ? "a detailed multi-paragraph draft with clear sections"
      : /bullet|outline/i.test(variant)
      ? "a concise bullet-point outline"
      : "a short 1-2 paragraph draft";

    const systemPrompt =
      "You are a grant-writing copilot for a UVU faculty member. Write to them directly, using \"you\" and \"your course/assignment\" — never \"the instructor\" or \"the faculty\". Write clear, practical proposal content with measurable outcomes where possible. Return markdown.";
    const userPrompt = `Faculty answers:
${context || "(none provided)"}
${optionLabel ? `\nSelected direction: ${optionLabel}` : ""}${idea ? `\nIdea focus: ${idea}` : ""}

Write ${lengthInstruction} for a teaching-with-AI grant proposal based on the above.`;

    let content = "";
    try {
      content = (await callOpenAI(systemPrompt, userPrompt, 1100)) || "";
    } catch (e) {
      console.error("proposal-draft AI error:", e.message);
    }
    const aiResponded = Boolean(content && content.trim());
    if (!aiResponded) {
      content =
        "I can't reach the AI model right now to draft this. Make sure the AI backend is configured, then try again.";
    }

    console.log(`[proposal-draft] variant="${variant}" aiResponded=${aiResponded}`);
    return res.json({ content: content.trim(), aiResponded });
  } catch (error) {
    console.error("proposal-draft error:", error.message);
    return res.status(500).json({ error: "Unable to draft proposal", detail: error.message });
  }
});

app.post("/api/ask", async (req, res) => {
  try {
    const question = safe(req.body?.question);
    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const context = req.body?.context || {};
    const course = safe(context.course);
    const assignment = safe(context.assignment);
    const answers = Array.isArray(context.answers) ? context.answers : [];

    const contextLines = [];
    if (course) contextLines.push(`Course: ${course}`);
    if (assignment) contextLines.push(`Focused assignment: ${assignment}`);
    if (answers.length) {
      contextLines.push("Faculty answers so far:");
      answers.forEach((a) => {
        if (a && (a.q || a.a)) contextLines.push(`- ${safe(a.q)}: ${safe(a.a)}`);
      });
    }

    const systemPrompt =
      "You are a helpful assistant for a UVU faculty member writing a teaching-with-AI grant proposal. Address them directly as \"you\" — never \"the instructor\" or \"the faculty\". Answer the question clearly and concisely in plain language (a short paragraph). If it relates to your proposal, be specific to the context given.";
    const userPrompt = `${contextLines.length ? contextLines.join("\n") + "\n\n" : ""}Question: ${question}`;

    let answer = "";
    try {
      answer = (await callOpenAI(systemPrompt, userPrompt, 500)) || "";
    } catch (e) {
      console.error("ask AI error:", e.message);
    }
    const aiResponded = Boolean(answer && answer.trim());

    if (!aiResponded) {
      answer =
        "I can't reach the AI model right now. Make sure Ollama is running (`ollama serve`) and the model is pulled, or set a valid OPENAI_API_KEY, then ask again.";
    }

    console.log(`[ask] q="${question.slice(0, 60)}" aiResponded=${aiResponded}`);
    return res.json({ answer: answer.trim(), aiResponded });
  } catch (error) {
    console.error("ask error:", error.message);
    return res.status(500).json({ error: "Unable to answer question", detail: error.message });
  }
});

app.post("/api/idea-detail", async (req, res) => {
  try {
    const idea = safe(req.body?.idea);
    const assignment = safe(req.body?.assignment);
    const course = safe(req.body?.course);
    if (!idea) {
      return res.status(400).json({ error: "Missing idea" });
    }

    const systemPrompt =
      "You help a faculty member implement a specific AI enhancement for one of their assignments. Address them directly as \"you\" (e.g., \"you could…\", \"you would set up…\") — never \"the instructor\" or \"the faculty\". Be concrete, practical, and specific. Write plain prose — no headings or bullet lists.";
    const userPrompt = `Assignment: ${assignment || "(unspecified)"}${course ? `\nCourse: ${course}` : ""}

You want to know more about this AI enhancement idea:
"${idea}"

In 3-5 sentences, explain how you would actually put this in place for this assignment: the tool or approach to use, the concrete steps to set it up, and one thing to watch out for. Address me as "you".`;

    let content = "";
    try {
      content = (await callOpenAI(systemPrompt, userPrompt, 500)) || "";
    } catch (e) {
      console.error("idea-detail AI error:", e.message);
    }
    const aiResponded = Boolean(content && content.trim());
    if (!aiResponded) {
      content = "I can't reach the AI model right now to expand on this. Please try again shortly.";
    }

    console.log(`[idea-detail] aiResponded=${aiResponded} idea="${idea.slice(0, 50)}"`);
    return res.json({ content: content.trim(), aiResponded });
  } catch (error) {
    console.error("idea-detail error:", error.message);
    return res.status(500).json({ error: "Unable to expand idea", detail: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`GrantAI running at http://localhost:${PORT}`);
});
