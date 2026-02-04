import express from "express";
import multer from "multer";
import * as authController from "../controllers/authController.js";
import * as coursesController from "../controllers/coursesController.js";
import * as assignmentsController from "../controllers/assignmentsController.js";
import * as forumsController from "../controllers/forumsController.js";
import * as filesController from "../controllers/filesController.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// AUTENTICACION
router.get("/health", authController.health);
router.get("/auth/google/start", authController.googleStart);
router.get("/auth/google/callback", authController.googleCallback);
router.post("/auth/login", authController.login);
router.post("/auth/google", authController.googleLogin);
router.post("/auth/link-google-moodle", authController.linkGoogleMoodle);

// MIDDLEWARE - Todas las rutas siguientes requieren autenticacion
router.use(requireAuth);

// CURSOS
router.get("/courses", coursesController.getCourses);
router.get("/course/:courseId/contents", coursesController.getCourseContents);
router.get("/course/:courseId/grades", coursesController.getCourseGrades);
router.get("/course/:courseId/assignments", assignmentsController.getCourseAssignments);
router.get("/course/:courseId/forums", forumsController.getCourseForums);

// TAREAS
router.get(
  "/assign/:assignId/status",
  assignmentsController.getAssignmentStatus,
);
router.post(
  "/assign/:assignId/save-text",
  assignmentsController.saveAssignmentText,
);
router.post("/assign/:assignId/submit", assignmentsController.submitAssignment);
router.post(
  "/assign/:assignId/save-file",
  upload.single("file"),
  assignmentsController.saveAssignmentFile,
);

// FOROS
router.get("/forum/:forumId/discussions", forumsController.getForumDiscussions);
router.get(
  "/discussion/:discussionId/posts",
  forumsController.getDiscussionPosts,
);
router.post("/forum/reply", forumsController.replyToForum);

// ARCHIVOS
router.get("/file", filesController.downloadFile);

export default router;
