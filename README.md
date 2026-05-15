# GrantAI

GrantAI is a web app for UVU faculty to prepare stronger grant proposals through a three-step workflow:

1. Expose: Review rubric criteria and success signals.
2. Explore: Generate rubric-aligned project ideas.
3. Execute: Complete six required boxes and draft a proposal.

## Features

- Rubric criteria display (Expose)
- AI-supported idea generation (Explore)
- Optional external API connection for Explore ideas
- 6-box proposal drafting flow (Execute)
- Automatic rubric grading when drafting a proposal
- Software advisor chat tied to Box 6
- Software directory modal with available tools
- Automatic fallback responses when no API key is configured

## 6 Execute Boxes

- Box 1: The course the faculty works with
- Box 2: The assignment/assessment to be affected
- Box 3: What you want to build (connects to rubric)
- Box 4: How your idea will improve learning (connects to rubric)
- Box 5: How much money is needed
- Box 6: Software needed

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
copy .env.example .env
```

3. Add an OpenAI API key in `.env` if you want live LLM responses:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=5050
```

4. Optional: configure an external ideas API for Option 2 (Explore):

```env
IDEAS_API_URL=https://your-ideas-api.example.com/generate
IDEAS_API_KEY=your_service_key
IDEAS_API_AUTH_HEADER=x-api-key
IDEAS_API_AUTH_SCHEME=
IDEAS_API_TIMEOUT_MS=25000
RUBRIC_GRADER_API_URL=https://your-grader-api.example.com/grade
RUBRIC_GRADER_API_KEY=your_grader_key
RUBRIC_GRADER_API_AUTH_HEADER=x-api-key
RUBRIC_GRADER_API_AUTH_SCHEME=
RUBRIC_GRADER_API_TIMEOUT_MS=30000
```

If `IDEAS_API_AUTH_SCHEME` is set to `Bearer`, the header will be sent as `Bearer <IDEAS_API_KEY>`.
If `RUBRIC_GRADER_API_AUTH_SCHEME` is set to `Bearer`, the header will be sent as `Bearer <RUBRIC_GRADER_API_KEY>`.

When `RUBRIC_GRADER_API_URL` is not set, the app still returns a rubric grade using internal AI (if configured) or a deterministic fallback heuristic.

5. Run the app:

```bash
npm run dev
```

6. Open:

`http://localhost:5050`

## API Endpoints

- `GET /api/rubric`
- `GET /api/software`
- `POST /api/explore`
- `POST /api/execute`
- `POST /api/software-chat`
