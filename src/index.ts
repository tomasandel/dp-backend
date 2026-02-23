import express from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";
import healthcheckRouter from "./routes/healthcheck";
import sthRouter from "./routes/sth";
import statsRouter from "./routes/stats";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/healthcheck", healthcheckRouter);
app.use("/api/sth", sthRouter);
app.use("/api/stats", statsRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
});
