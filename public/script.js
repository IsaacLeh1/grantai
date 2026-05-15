const rubricGrid = document.getElementById("rubric-grid");
const expandRubricBtn = document.getElementById("expand-rubric");
const collapseRubricBtn = document.getElementById("collapse-rubric");
const exploreForm = document.getElementById("explore-form");
const exploreOutput = document.getElementById("explore-output");
const executeForm = document.getElementById("execute-form");
const executeOutput = document.getElementById("execute-output");
const executeGradeOutput = document.getElementById("execute-grade-output");

const softwareChat = document.getElementById("software-chat");
const openSoftwareChatBtn = document.getElementById("open-software-chat");
const closeSoftwareChatBtn = document.getElementById("close-software-chat");
const showSoftwareListBtn = document.getElementById("show-software-list");
const softwareDialog = document.getElementById("software-dialog");
const softwareList = document.getElementById("software-list");

const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

let softwareCache = [];

function setPanelVisible(panel, visible) {
  if (!panel) {
    return;
  }
  panel.classList.toggle("visible", visible);
}

setPanelVisible(exploreOutput, false);
setPanelVisible(executeOutput, false);
setPanelVisible(executeGradeOutput, false);

function setRubricExpansion(expanded) {
  const items = rubricGrid.querySelectorAll("details.rubric-item");
  items.forEach((item) => {
    item.open = expanded;
  });
}

if (rubricGrid) {
  rubricGrid.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) {
      return;
    }

    if (!target.classList.contains("rubric-item") || !target.open) {
      return;
    }

    const items = rubricGrid.querySelectorAll("details.rubric-item");
    items.forEach((item) => {
      if (item !== target) {
        item.open = false;
      }
    });
  });
}

if (expandRubricBtn) {
  expandRubricBtn.addEventListener("click", () => setRubricExpansion(true));
}

if (collapseRubricBtn) {
  collapseRubricBtn.addEventListener("click", () => setRubricExpansion(false));
}

function renderMarkdown(target, markdown) {
  if (window.marked) {
    target.innerHTML = marked.parse(markdown || "");
  } else {
    target.textContent = markdown || "";
  }
}

function formatRubricLevelLabel(levelKey) {
  return levelKey.charAt(0).toUpperCase() + levelKey.slice(1);
}

function scoreForLevel(levelKey) {
  const levelPointMap = {
    exemplary: 4,
    proficient: 3,
    developing: 2,
    beginning: 1,
    small: 0.5,
    zero: 0
  };

  return levelPointMap[levelKey] ?? 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addChatMessage(role, text) {
  const message = document.createElement("div");
  message.className = `msg ${role}`;
  message.innerHTML = role === "bot" && window.marked ? marked.parse(text) : text;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function loadRubric() {
  rubricGrid.innerHTML = "Loading rubric criteria...";
  try {
    const rubric = await fetchJSON("/api/rubric");
    rubricGrid.innerHTML = "";

    rubric.criteria.forEach((criterion, index) => {
      const item = document.createElement("details");
      item.className = "rubric-item";
      item.style.animation = `rise-in ${220 + index * 80}ms ease`;

      if (index === 0) {
        item.open = true;
      }

      const weight = Number.isFinite(criterion.weightPercent)
        ? `<span class="weight-badge">${criterion.weightPercent}%</span>`
        : "";

      const levels = criterion.levels
        ? `
          <ul class="level-list">
            ${Object.entries(criterion.levels)
              .map(([levelKey, levelText]) => `<li><strong>${formatRubricLevelLabel(levelKey)}:</strong> ${levelText || "N/A"}</li>`)
              .join("")}
          </ul>
        `
        : `<ul>${(criterion.signals || []).map((signal) => `<li>${signal}</li>`).join("")}</ul>`;

      item.innerHTML = `
        <summary>
          <span class="rubric-title">${criterion.name}</span>
          ${weight}
        </summary>
        <div class="rubric-body">
          <p>${criterion.description}</p>
          ${levels}
        </div>
      `;

      rubricGrid.appendChild(item);
    });

  } catch (err) {
    rubricGrid.textContent = `Failed to load rubric: ${err.message}`;
  }
}

async function loadSoftware() {
  const data = await fetchJSON("/api/software");
  softwareCache = data.items || [];
  softwareList.innerHTML = "";
  softwareCache.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.name}</strong> - ${item.category}<br>${item.notes}<br><em>${item.costModel}</em>`;
    softwareList.appendChild(li);
  });
}

exploreForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(exploreForm);

  setPanelVisible(exploreOutput, true);
  exploreOutput.textContent = "Generating ideas...";
  try {
    const payload = Object.fromEntries(formData.entries());
    const result = await fetchJSON("/api/explore", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderMarkdown(exploreOutput, result.content);
  } catch (err) {
    exploreOutput.textContent = `Unable to generate ideas: ${err.message}`;
  }
});

executeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(executeForm);

  setPanelVisible(executeOutput, true);
  setPanelVisible(executeGradeOutput, true);
  executeOutput.textContent = "Drafting proposal...";
  executeGradeOutput.textContent = "Grading proposal against rubric...";
  try {
    const payload = Object.fromEntries(formData.entries());
    const result = await fetchJSON("/api/execute", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderMarkdown(executeOutput, result.content);
    renderMarkdown(executeGradeOutput, result.gradingReport || "## Rubric Grade\n- No grade returned.");
  } catch (err) {
    executeOutput.textContent = `Unable to draft proposal: ${err.message}`;
    setPanelVisible(executeGradeOutput, false);
    executeGradeOutput.textContent = "";
  }
});

openSoftwareChatBtn.addEventListener("click", () => {
  softwareChat.classList.add("open");
  if (!chatMessages.children.length) {
    addChatMessage("bot", "Ask me what software best fits your grant idea, assignment, or budget.");
  }
});

closeSoftwareChatBtn.addEventListener("click", () => {
  softwareChat.classList.remove("open");
});

showSoftwareListBtn.addEventListener("click", async () => {
  try {
    if (!softwareCache.length) {
      await loadSoftware();
    }
    softwareDialog.showModal();
  } catch (err) {
    alert(`Unable to load software list: ${err.message}`);
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  addChatMessage("user", message);
  chatInput.value = "";

  const formData = new FormData(executeForm);
  const formValues = Object.fromEntries(formData.entries());

  try {
    const result = await fetchJSON("/api/software-chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        course: formValues.box1 || "",
        idea: formValues.box3 || ""
      })
    });
    addChatMessage("bot", result.content);
  } catch (err) {
    addChatMessage("bot", `Sorry, I could not answer right now: ${err.message}`);
  }
});

loadRubric();
loadSoftware().catch(() => {
  // Software list can be lazily loaded later if initial fetch fails.
});

// ========== AUTOFILL FUNCTIONALITY FOR DEMO ==========

document.getElementById("autofill-explore")?.addEventListener("click", () => {
  exploreForm.elements["ideaSource"].value = "internal-ai";
  exploreForm.elements["course"].value = "Introduction to Data Science";
  exploreForm.elements["assignment"].value = "Final capstone project with AI analysis";
  exploreForm.elements["goal"].value = "Students will learn to apply machine learning models to real-world datasets and understand AI model limitations";
  exploreForm.elements["budget"].value = "$3,500";
  exploreForm.elements["software"].value = "Python-based ML frameworks, Jupyter notebooks, data visualization tools";
});

document.getElementById("clear-explore")?.addEventListener("click", () => {
  exploreForm.reset();
  setPanelVisible(exploreOutput, false);
  exploreOutput.textContent = "";
});

document.getElementById("autofill-execute")?.addEventListener("click", () => {
  executeForm.elements["box1"].value = "CS 2300 - Data Science";
  executeForm.elements["box2"].value = "Students complete a capstone project analyzing real-world datasets using machine learning algorithms";
  executeForm.elements["box3"].value = "Implement an AI-powered peer review system that provides automated, rubric-aligned feedback on student data analysis work, helping identify methodological issues early and guide model selection";
  executeForm.elements["box4"].value = "By using AI feedback during development, students strengthen critical thinking in data analysis, understand model limitations, practice scientific reasoning, and build confidence with real-world datasets";
  executeForm.elements["box5"].value = "$4,200";
  executeForm.elements["box6"].value = "Python (scikit-learn, pandas, TensorFlow), Jupyter notebooks, AWS or Google Cloud for model deployment, plagiarism/similarity detection API";
});

document.getElementById("clear-execute")?.addEventListener("click", () => {
  executeForm.reset();
  setPanelVisible(executeOutput, false);
  setPanelVisible(executeGradeOutput, false);
  executeOutput.textContent = "";
  executeGradeOutput.textContent = "";
});

// ========== REVIEW PHASE FUNCTIONALITY ==========

const applicationsList = document.getElementById("applications-list");
const reviewFormContainer = document.getElementById("review-form-container");
const reviewForm = document.getElementById("review-form");
const appHeader = document.getElementById("app-header");
const reviewCriteriaInputs = document.getElementById("review-criteria-inputs");
const reviewSubmitOutput = document.getElementById("review-submit-output");

let currentRubric = null;
let currentApplication = null;

async function loadRubricForReview() {
  try {
    const rubric = await fetchJSON("/api/rubric");
    currentRubric = rubric;
    return rubric;
  } catch (err) {
    console.error("Failed to load rubric for review:", err);
    return null;
  }
}

async function loadApplications() {
  if (!applicationsList) return;
  
  applicationsList.innerHTML = "Loading applications...";
  try {
    const data = await fetchJSON("/api/applications");
    const apps = data.applications || [];
    
    if (apps.length === 0) {
      applicationsList.innerHTML = "<p>No applications to review yet.</p>";
      return;
    }
    
    applicationsList.innerHTML = "";
    apps.forEach((app) => {
      const card = document.createElement("div");
      card.className = "application-card";
      card.innerHTML = `
        <div class="app-name">${app.facultyName}</div>
        <div class="app-course">${app.course}</div>
        <div style="font-size: 0.85rem; color: var(--ink-soft); margin-top: 0.4rem;">
          ${app.assignment}
        </div>
        <div style="margin-top: 0.5rem;">
          <span class="app-status">Submitted</span>
        </div>
      `;
      
      card.addEventListener("click", () => {
        selectApplication(app);
      });
      
      applicationsList.appendChild(card);
    });
  } catch (err) {
    applicationsList.innerHTML = `<p>Failed to load applications: ${err.message}</p>`;
  }
}

function selectApplication(app) {
  currentApplication = app;
  
  // Update cards to show selection
  const cards = applicationsList.querySelectorAll(".application-card");
  cards.forEach((card) => {
    card.classList.remove("selected");
  });
  event.currentTarget.classList.add("selected");
  
  // Show review form and populate it
  if (reviewFormContainer) {
    reviewFormContainer.style.display = "block";
    populateReviewForm(app);
  }
}

async function populateReviewForm(app) {
  if (!currentRubric) {
    const rubric = await loadRubricForReview();
    if (!rubric) {
      appHeader.innerHTML = "<p>Could not load rubric criteria.</p>";
      return;
    }
  }
  
  // Show application header
  appHeader.innerHTML = `
    <h3>${app.facultyName}</h3>
    <p><strong>Course:</strong> ${app.course}</p>
    <p><strong>Assignment:</strong> ${app.assignment}</p>
    <p style="background: rgba(255, 255, 255, 0.6); padding: 0.5rem; border-radius: 6px; margin-top: 0.5rem;">
      <strong>Proposal Summary:</strong> ${app.proposedIdeaSummary}
    </p>
  `;
  
  // Build criteria input fields
  reviewCriteriaInputs.innerHTML = "";
  
  currentRubric.criteria.forEach((criterion) => {
    const group = document.createElement("div");
    group.className = "criterion-input-group";
    const proposalText = app.fullProposal || app.proposedIdeaSummary || "No proposal text was provided.";
    
    const levelEntries = Object.entries(criterion.levels || {});
    const scoreOptions = levelEntries
      .map(([key, label]) => {
        const points = scoreForLevel(key);
        return `
          <label class="score-choice">
            <input type="checkbox" name="criterion-${criterion.id}" value="${points}" data-criterion-group="criterion-${criterion.id}">
            <span class="score-choice-label">
              <strong>${points} pts</strong>
              <span>${formatRubricLevelLabel(key)}: ${label}</span>
            </span>
          </label>
        `;
      })
      .join("");
    
    group.innerHTML = `
      <label class="criterion-label">${criterion.name}</label>
      <span class="criterion-description">${criterion.description}</span>
      <div class="proposal-reference">
        <span class="proposal-reference-label">Faculty proposal reference</span>
        <p>${escapeHtml(proposalText)}</p>
      </div>
      <div class="score-choice-grid" data-criterion-group="criterion-${criterion.id}">
        ${scoreOptions}
      </div>
    `;
    
    reviewCriteriaInputs.appendChild(group);
  });

  reviewCriteriaInputs.querySelectorAll('input[type="checkbox"][data-criterion-group]').forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLInputElement) || !target.checked) {
        return;
      }

      const groupName = target.dataset.criterionGroup;
      if (!groupName) {
        return;
      }

      reviewCriteriaInputs.querySelectorAll(`input[type="checkbox"][data-criterion-group="${groupName}"]`).forEach((item) => {
        if (item !== target) {
          item.checked = false;
        }
      });
    });
  });
  
  // Scroll to form
  reviewFormContainer.scrollIntoView({ behavior: "smooth", block: "start" });
}

if (reviewForm) {
  reviewForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    if (!currentApplication) {
      alert("No application selected");
      return;
    }
    
    const formData = new FormData(reviewForm);
    const scores = {};
    
    // Extract scores for each criterion
    currentRubric.criteria.forEach((criterion) => {
      const checked = reviewForm.querySelector(`input[type="checkbox"][data-criterion-group="criterion-${criterion.id}"]:checked`);
      if (checked) {
        scores[criterion.id] = parseFloat(checked.value);
      }
    });

    const missingCriteria = currentRubric.criteria
      .filter((criterion) => scores[criterion.id] === undefined)
      .map((criterion) => criterion.name);

    if (missingCriteria.length > 0) {
      alert(`Please select one score for each criterion before submitting. Missing: ${missingCriteria.join(", ")}`);
      return;
    }
    
    const reviewData = {
      applicationId: currentApplication.id,
      reviewerName: formData.get("reviewerName"),
      comments: formData.get("comments"),
      scores: scores,
      timestamp: new Date().toISOString()
    };
    
    setPanelVisible(reviewSubmitOutput, true);
    reviewSubmitOutput.textContent = "Submitting review...";
    
    try {
      const result = await fetchJSON("/api/reviews", {
        method: "POST",
        body: JSON.stringify(reviewData)
      });
      
      setPanelVisible(reviewSubmitOutput, true);
      reviewSubmitOutput.innerHTML = `
        <h3 style="color: var(--accent); margin-top: 0;">✓ Review Submitted</h3>
        <p>Thank you! Your evaluation for ${currentApplication.facultyName}'s proposal has been recorded.</p>
        <p style="font-size: 0.9rem; color: var(--ink-soft);">Review ID: ${result.reviewId}</p>
      `;
      
      // Reset form
      setTimeout(() => {
        reviewForm.reset();
        reviewSubmitOutput.style.display = "none";
        reviewFormContainer.style.display = "none";
        currentApplication = null;
        loadApplications();
      }, 2000);
      
    } catch (err) {
      reviewSubmitOutput.textContent = `Failed to submit review: ${err.message}`;
    }
  });
}

// Load applications on page load
loadApplications();
