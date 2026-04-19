import cors from "cors";
import express from "express";
import { getSpinStats, insertSpin, listSpins, parseSpinPayload } from "./store";

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/api/results", async (req, res) => {
  try {
    const queryLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const results = await listSpins(queryLimit);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "failed_to_list_results", detail: String(error) });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const stats = await getSpinStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "failed_to_compute_stats", detail: String(error) });
  }
});

app.post("/api/results", async (req, res) => {
  try {
    const payload = parseSpinPayload(req.body);
    if (!payload) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    const inserted = await insertSpin(payload);
    res.status(201).json({ item: inserted });
  } catch (error) {
    res.status(500).json({ error: "failed_to_insert_result", detail: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`[dreidel-api] listening on http://localhost:${PORT}`);
});
