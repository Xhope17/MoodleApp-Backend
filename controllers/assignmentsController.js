import axios from "axios";
import FormData from "form-data";
import { moodleCall, getUserAuth } from "../helpers/moodle.js";
import { MOODLE_BASE } from "../config/env.js";

// Obtiene todas las tareas de un curso con sus detalles
export async function getCourseAssignments(req, res) {
  try {
    const courseId = parseInt(req.params.courseId);
    const data = await moodleCall(req, "mod_assign_get_assignments", {
      "courseids[0]": courseId,
    });
    res.json({ ok: true, assignments: data.courses?.[0]?.assignments || [] });
  } catch (e) {
    console.error("Error en getCourseAssignments:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Obtiene el estado de una tarea y su entrega
export async function getAssignmentStatus(req, res) {
  try {
    // Primero obtener el userid del token
    const userInfo = await moodleCall(req, "core_webservice_get_site_info", {});
    const userId = userInfo.userid;
    
    const data = await moodleCall(req, "mod_assign_get_submission_status", {
      assignid: req.params.assignId,
      userid: userId,
    });
    
    res.json({ ok: true, status: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Guarda el texto de una tarea en linea
export async function saveAssignmentText(req, res) {
  try {
    const { text } = req.body;
    const result = await moodleCall(req, "mod_assign_save_submission", {
      assignmentid: req.params.assignId,
      "plugindata[onlinetext_editor][text]": text,
      "plugindata[onlinetext_editor][format]": 1,
      "plugindata[onlinetext_editor][itemid]": 0,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Envia una tarea para calificacion
export async function submitAssignment(req, res) {
  try {
    const result = await moodleCall(req, "mod_assign_submit_for_grading", {
      assignmentid: req.params.assignId,
      acceptsubmissionstatement: 1,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Sube un archivo como entrega de tarea
export async function saveAssignmentFile(req, res) {
  try {
    const token = getUserAuth(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Falta token" });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, error: "No se recibió archivo" });
    }

    const uploadUrl = `${MOODLE_BASE}/webservice/upload.php`;

    const form = new FormData();
    form.append("token", token);
    form.append("file", req.file.buffer, req.file.originalname);

    console.log("Subiendo a Moodle:", uploadUrl);

    const uploadRes = await axios.post(uploadUrl, form, {
      headers: form.getHeaders(),
    });

    const uploadedFiles = uploadRes.data;
    console.log("Respuesta de Moodle:", uploadedFiles);

    if (uploadedFiles.error) {
      console.log("Error de Moodle:", uploadedFiles.error);
      throw new Error(uploadedFiles.error);
    }
    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
      if (uploadedFiles.exception) {
        console.log("Excepción de Moodle:", uploadedFiles.message);
        throw new Error(uploadedFiles.message);
      }
      console.log("Array vacío o inválido");
      throw new Error("Error desconocido al subir archivo al Draft Area");
    }

    const draftItemId = uploadedFiles[0].itemid;

    const result = await moodleCall(req, "mod_assign_save_submission", {
      assignmentid: req.params.assignId,
      "plugindata[files_filemanager]": draftItemId,
    });

    res.json({ ok: true, result });
  } catch (e) {
    const errorMsg =
      e.response?.data?.message || e.message || "Error desconocido";
    res.status(500).json({ ok: false, error: errorMsg });
  }
}
