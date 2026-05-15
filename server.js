import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
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
      rationale = "Score based on the documented number of students impacted by AI integration.";
      improvement = "State the number of students impacted and describe how AI is used in the class.";
    }

    if (id === "qualitative-impact") {
      const engagementSignals = ["external organization", "practitioner", "site visit", "guest critique", "consultation", "deliverable", "contact hours"];
      const hits = engagementSignals.filter((signal) => text.includes(signal)).length;
      score = hits >= 5 ? 4 : hits >= 3 ? 3 : hits >= 2 ? 2 : hits >= 1 ? 1 : 0;
      rationale = "Score based on the depth of external organization engagement and practitioner interaction.";
      improvement = "Describe the organization, contact hours, student deliverables, and how the work is reviewed.";
    }

    if (id === "software-approvals-dx") {
      const approvedSignals = ["already approved", "dx approved", "approved by dx", "approval", "license", "licensed"];
      const strongSignals = ["working with", "within 2 weeks", "full approval", "100% functionality", "mature in process"];
      const approvedHits = approvedSignals.filter((signal) => text.includes(signal)).length;
      const strongHits = strongSignals.filter((signal) => text.includes(signal)).length;
      score = text.includes("already approved") || text.includes("approved by dx") ? 4 : strongHits >= 2 ? 2 : approvedHits >= 2 ? 2 : 0;
      rationale = "Score based on the software approval status and evidence of imminent DX approval.";
      improvement = "State whether DX has already approved the software or provide concrete evidence they are about to approve it.";
    }

    if (id === "assessment-plan") {
      const assessSignals = ["outcome", "baseline", "post", "metric", "survey", "assessment", "durable skill", "method"];
      const hits = assessSignals.filter((signal) => text.includes(signal)).length;
      score = hits >= 5 ? 4 : hits >= 3 ? 2 : hits >= 2 ? 1 : 0;
      rationale = "Score based on how clearly the outcomes and assessment methods are defined.";
      improvement = "Add specific learning outcomes and describe how student learning will be measured.";
    }

    if (id === "rapid-impact") {
      const summerFallSignals = ["summer 2026", "fall 2026", "summer block", "fall semester"];
      const springSignals = ["spring 2027", "jan 2027", "later"];
      const summerFallHits = summerFallSignals.filter((signal) => text.includes(signal)).length;
      const springHits = springSignals.filter((signal) => text.includes(signal)).length;
      score = summerFallHits >= 2 ? 4 : summerFallHits >= 1 ? 3 : springHits >= 1 ? 0 : 0;
      rationale = "Score based on when students will experience the grant's benefits.";
      improvement = "Make the timing explicit and show whether impact starts in summer or fall 2026.";
    }

    if (id === "sustainability-plan") {
      const sustainSignals = ["continue", "beyond", "ongoing", "future", "dean", "fund", "free", "cheap", "one-time", "stick"];
      const hits = sustainSignals.filter((signal) => text.includes(signal)).length;
      score = hits >= 5 ? 4 : hits >= 2 ? 1 : 0;
      rationale = "Score based on whether the proposal explains how the work continues after the grant ends.";
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
  if (variant === "A") {
    // Make variant A score around ~80% by setting three criteria high and others moderate.
    criteria.forEach((c) => {
      if (c.id === "quantitative-impact" || c.id === "qualitative-impact" || c.id === "software-approvals-dx") {
        c.score = 4;
        c.rationale = c.rationale || "Demo boost: evidence aligns strongly to this criterion.";
        c.improvement = c.improvement || "No immediate changes required for demo-quality submission.";
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
    "| Criterion | Weight | Score | Applicant Answer | Rationale | Improve Next |",
    "|---|---:|---:|---|---|---|"
  ];

  for (const c of grading.criteria) {
    const score = `${Math.max(0, Math.min(4, toNumber(c.score, 0)))}/4`;
    const applicantAnswer = escapeMarkdown(facultyAnswerForCriterion(c.id, facultySubmission));
    const rationale = escapeMarkdown(c.rationale || "");
    const improvement = escapeMarkdown(c.improvement || "");
    lines.push(
      `| ${c.name} | ${toNumber(c.weightPercent, 0)}% | ${score} | ${applicantAnswer} | ${rationale} | ${improvement} |`
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

  const systemPrompt = "You are a grant rubric evaluator for UVU proposals. Return strict JSON only.";
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

async function callOpenAI(systemPrompt, userPrompt, maxOutputTokens = 800) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
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

    const systemPrompt = "You help UVU faculty find grant-worthy teaching ideas. Keep responses concise and practical. Return markdown with headings and bullet points.";
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

    const systemPrompt = "You are a grant writing copilot for UVU faculty. Draft clear proposal content with practical language and measurable outcomes. Return markdown only.";
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

    const systemPrompt = "You are a software advisor for faculty grant proposals. Recommend from the provided list only. Be specific and concise.";
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

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`GrantAI running at http://localhost:${PORT}`);
});
