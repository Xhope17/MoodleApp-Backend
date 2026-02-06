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

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada no manejada:', reason);
});

// Iniciar servidor
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend corriendo en puerto ${PORT}`);
  console.log(`Servidor listo para recibir peticiones`);
});

// IMPORTANTE: Keep-alive para prevenir que Node.js cierre el proceso
const keepAlive = setInterval(() => {
  // Este intervalo mantiene el event loop activo
}, 60000); // Cada 60 segundos

// Asegurar que el servidor se mantenga corriendo
server.on('close', () => {
  console.log('⚠️  Servidor cerrado');
  clearInterval(keepAlive);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    console.log('Servidor cerrado correctamente');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT recibido, cerrando servidor...');
  server.close(() => {
    console.log('Servidor cerrado correctamente');
    process.exit(0);
  });
});
