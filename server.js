import express from "express";
import cors from "cors";
import { PORT } from "./config/env.js";
import routes from "./routes/index.js";

const app = express();

// Configurar CORS para permitir peticiones desde el frontend
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    exposedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "50mb" }));

app.use(routes);

// Iniciar servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend corriendo en puerto ${PORT}`);
});
