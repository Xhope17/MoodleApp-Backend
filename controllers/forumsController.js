import { moodleCall } from "../helpers/moodle.js";

// Obtiene los detalles de todos los foros de un curso
export async function getCourseForums(req, res) {
  try {
    const data = await moodleCall(req, "mod_forum_get_forums_by_courses", {
      "courseids[0]": req.params.courseId,
    });
    res.json({ ok: true, forums: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Obtiene las discusiones de un foro
export async function getForumDiscussions(req, res) {
  try {
    const data = await moodleCall(req, "mod_forum_get_forum_discussions", {
      forumid: req.params.forumId,
    });
    res.json({ ok: true, discussions: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Obtiene los posts de una discusion
export async function getDiscussionPosts(req, res) {
  try {
    const data = await moodleCall(req, "mod_forum_get_discussion_posts", {
      discussionid: req.params.discussionId,
    });
    res.json({ ok: true, posts: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Responde a un post en el foro
export async function replyToForum(req, res) {
  try {
    const { postid, subject, message } = req.body;

    const result = await moodleCall(req, "mod_forum_add_discussion_post", {
      postid: postid,
      subject: subject,
      message: message,
      "options[0][name]": "discussionsubscribe",
      "options[0][value]": true,
    });

    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
