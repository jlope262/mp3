const Task = require('../models/task');
const User = require('../models/user');

function parseJSONParam(param) {
  if (!param) return null;
  try {
    return JSON.parse(param);
  } catch (e) {
    return null;
  }
}

function parseBoolean(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return defaultVal;
}

module.exports = function (router) {

  // /api/tasks
  router.route('/tasks')
    // GET /api/tasks?where&sort&select/filter&skip&limit&count
    .get(async (req, res) => {
      try {
        const where  = parseJSONParam(req.query.where)  || {};
        const sort   = parseJSONParam(req.query.sort);
        const select = parseJSONParam(req.query.select) || parseJSONParam(req.query.filter);
        const skip   = req.query.skip ? parseInt(req.query.skip) : null;
        const limit  = req.query.limit ? parseInt(req.query.limit) : 100; // default 100 for tasks
        const count  = req.query.count === 'true';

        if (req.query.where && !where) {
          return res.status(400).json({ message: "Bad Request: invalid JSON in 'where'", data: [] });
        }
        if (req.query.sort && !sort) {
          return res.status(400).json({ message: "Bad Request: invalid JSON in 'sort'", data: [] });
        }
        if ((req.query.select || req.query.filter) && !select) {
          return res.status(400).json({ message: "Bad Request: invalid JSON in 'select/filter'", data: [] });
        }

        if (count) {
          const c = await Task.countDocuments(where);
          return res.status(200).json({ message: "OK", data: c });
        }

        let query = Task.find(where);
        if (sort)   query = query.sort(sort);
        if (select) query = query.select(select);
        if (skip)   query = query.skip(skip);
        if (limit)  query = query.limit(limit);

        const tasks = await query.exec();
        return res.status(200).json({ message: "OK", data: tasks });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    })

    // POST /api/tasks
    .post(async (req, res) => {
      try {
        const { name } = req.body;
        let { deadline } = req.body;

        if (!name || !deadline) {
          return res.status(400).json({ message: "Task name and deadline are required", data: {} });
        }

        // deadline may be ms timestamp or ISO string
        if (!isNaN(Number(deadline))) {
          deadline = new Date(Number(deadline));
        } else {
          deadline = new Date(deadline);
        }
        if (isNaN(deadline.getTime())) {
          return res.status(400).json({ message: "Invalid deadline date", data: {} });
        }

        let completed = parseBoolean(req.body.completed, false);

        let assignedUser     = req.body.assignedUser || "";
        let assignedUserName = req.body.assignedUserName || "unassigned";

        // If assignedUser is non-empty, verify user exists and sync name
        if (assignedUser) {
          const user = await User.findById(assignedUser);
          if (!user) {
            return res.status(400).json({ message: "Assigned user not found", data: {} });
          }
          assignedUserName = user.name;
        } else {
          assignedUserName = "unassigned";
        }
        // create new task
        const task = new Task({
          name,
          description: req.body.description || "",
          deadline,
          completed,
          assignedUser,
          assignedUserName
        });

        const savedTask = await task.save();

        // Two-way reference: if assigned and not completed, add to user's pendingTasks
        if (assignedUser && !completed) {
          await User.findByIdAndUpdate(
            assignedUser,
            { $addToSet: { pendingTasks: savedTask._id.toString() } }
          );
        }

        return res.status(201).json({ message: "Task created", data: savedTask });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    });

  // /api/tasks/:id
  router.route('/tasks/:id')
    // GET /api/tasks/:id?select/filter
    .get(async (req, res) => {
      try {
        const select = parseJSONParam(req.query.select) || parseJSONParam(req.query.filter);
        if ((req.query.select || req.query.filter) && !select) {
          return res.status(400).json({ message: "Bad Request: invalid JSON in 'select/filter'", data: {} });
        }

        let query = Task.findById(req.params.id);
        if (select) query = query.select(select);

        const task = await query.exec();
        if (!task) {
          return res.status(404).json({ message: "Task not found", data: {} });
        }

        return res.status(200).json({ message: "OK", data: task });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    })

    // PUT /api/tasks/:id
    .put(async (req, res) => {
      try {
        const id = req.params.id;

        const existingTask = await Task.findById(id);
        if (!existingTask) {
          return res.status(404).json({ message: "Task not found", data: {} });
        }

        const { name } = req.body;
        let { deadline } = req.body;

        if (!name || !deadline) {
          return res.status(400).json({ message: "Task name and deadline are required", data: {} });
        }

        if (!isNaN(Number(deadline))) {
          deadline = new Date(Number(deadline));
        } else {
          deadline = new Date(deadline);
        }
        if (isNaN(deadline.getTime())) {
          return res.status(400).json({ message: "Invalid deadline date", data: {} });
        }

        const oldAssignedUser = existingTask.assignedUser || "";
        const oldCompleted    = !!existingTask.completed;

        let completed = parseBoolean(req.body.completed, oldCompleted);
        let assignedUser     = req.body.assignedUser !== undefined ? req.body.assignedUser : oldAssignedUser;
        let assignedUserName = req.body.assignedUserName || existingTask.assignedUserName;

        if (!assignedUser) {
          assignedUser = "";
          assignedUserName = "unassigned";
        } else {
          const user = await User.findById(assignedUser);
          if (!user) {
            return res.status(400).json({ message: "Assigned user not found", data: {} });
          }
          assignedUserName = user.name;
        }

        existingTask.name        = name;
        existingTask.description = req.body.description || existingTask.description;
        existingTask.deadline    = deadline;
        existingTask.completed   = completed;
        existingTask.assignedUser     = assignedUser;
        existingTask.assignedUserName = assignedUserName;

        const savedTask = await existingTask.save();

        const taskId = savedTask._id.toString();

        // Two-way reference updates
        // 1) Remove from old user's pendingTasks if needed
        if (oldAssignedUser) {
          const shouldRemove =
            oldAssignedUser !== assignedUser || oldCompleted || completed || !assignedUser;
          if (shouldRemove) {
            await User.findByIdAndUpdate(
              oldAssignedUser,
              { $pull: { pendingTasks: taskId } }
            );
          }
        }

        // 2) Add to new user's pendingTasks if assigned and not completed
        if (assignedUser && !completed) {
          await User.findByIdAndUpdate(
            assignedUser,
            { $addToSet: { pendingTasks: taskId } }
          );
        }

        return res.status(200).json({ message: "Task updated", data: savedTask });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    })

    // DELETE /api/tasks/:id
    .delete(async (req, res) => {
      try {
        const id = req.params.id;
        const task = await Task.findById(id);
        if (!task) {
          return res.status(404).json({ message: "Task not found", data: {} });
        }

        const assignedUser = task.assignedUser;

        // Remove from user's pendingTasks if present
        if (assignedUser) {
          await User.findByIdAndUpdate(
            assignedUser,
            { $pull: { pendingTasks: task._id.toString() } }
          );
        }

        await Task.deleteOne({ _id: id });

        return res.status(200).json({ message: "Task deleted", data: {} });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    });

  return router;
};
