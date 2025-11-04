// routes/users.js
const User = require('../models/user');
const Task = require('../models/task');

function parseJSONParam(param) {
  if (!param) return null;
  try {
    return JSON.parse(param);
  } catch (e) {
    return null;
  }
}

module.exports = function (router) {

  // /api/users
  router.route('/users')
    // GET /api/users?where&sort&select/filter&skip&limit&count
    .get(async (req, res) => {
      try {
        const where  = parseJSONParam(req.query.where)  || {};
        const sort   = parseJSONParam(req.query.sort);
        const select = parseJSONParam(req.query.select) || parseJSONParam(req.query.filter); // filter used by scripts
        const skip   = req.query.skip ? parseInt(req.query.skip) : null;
        const limit  = req.query.limit ? parseInt(req.query.limit) : null;
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
          const c = await User.countDocuments(where);
          return res.status(200).json({ message: "OK", data: c });
        }

        let query = User.find(where);
        if (sort)   query = query.sort(sort);
        if (select) query = query.select(select);
        if (skip)   query = query.skip(skip);
        if (limit)  query = query.limit(limit); // no default limit for users

        const users = await query.exec();
        return res.status(200).json({ message: "OK", data: users });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    })

    // POST /api/users
    .post(async (req, res) => {
      try {
        const { name, email } = req.body;

        if (!name || !email) {
          return res.status(400).json({ message: "Name and email are required", data: {} });
        }

        // Unique email check
        const existing = await User.findOne({ email: email });
        if (existing) {
          return res.status(400).json({ message: "A user with that email already exists", data: {} });
        }

        let pendingTasks = req.body.pendingTasks || [];
        if (!Array.isArray(pendingTasks)) pendingTasks = [pendingTasks];

        const user = new User({
          name: name,
          email: email,
          pendingTasks: pendingTasks
          // dateCreated defaults automatically
        });

        const saved = await user.save();
        return res.status(201).json({ message: "User created", data: saved });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    });

  // /api/users/:id
  router.route('/users/:id')
    // GET /api/users/:id?select/filter
    .get(async (req, res) => {
      try {
        const select = parseJSONParam(req.query.select) || parseJSONParam(req.query.filter);
        if ((req.query.select || req.query.filter) && !select) {
          return res.status(400).json({ message: "Bad Request: invalid JSON in 'select/filter'", data: {} });
        }

        let query = User.findById(req.params.id);
        if (select) query = query.select(select);

        const user = await query.exec();
        if (!user) {
          return res.status(404).json({ message: "User not found", data: {} });
        }

        return res.status(200).json({ message: "OK", data: user });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    })

    // PUT /api/users/:id
    .put(async (req, res) => {
      try {
        const id = req.params.id;
        const { name, email } = req.body;

        if (!name || !email) {
          return res.status(400).json({ message: "Name and email are required", data: {} });
        }

        // Ensure user exists
        const user = await User.findById(id);
        if (!user) {
          return res.status(404).json({ message: "User not found", data: {} });
        }

        // Check email uniqueness excluding this user
        const existing = await User.findOne({ email: email, _id: { $ne: id } });
        if (existing) {
          return res.status(400).json({ message: "A user with that email already exists", data: {} });
        }

        // Normalize pendingTasks from body
        let newPendingTasks = req.body.pendingTasks || [];
        if (!Array.isArray(newPendingTasks)) newPendingTasks = [newPendingTasks];
        newPendingTasks = newPendingTasks.map(String);

        const oldPendingTasks = (user.pendingTasks || []).map(String);

        user.name = name;
        user.email = email;
        user.pendingTasks = newPendingTasks;

        // allow preserving dateCreated if provided (dbFill does this)
        if (req.body.dateCreated) {
          user.dateCreated = new Date(req.body.dateCreated);
        }

        const savedUser = await user.save();

        const userId = user._id.toString();

        // Two-way reference: update tasks to match pendingTasks
        const tasksToAdd = newPendingTasks.filter(id => !oldPendingTasks.includes(id));
        const tasksToRemove = oldPendingTasks.filter(id => !newPendingTasks.includes(id));

        if (tasksToAdd.length) {
          await Task.updateMany(
            { _id: { $in: tasksToAdd } },
            { $set: { assignedUser: userId, assignedUserName: user.name, completed: false } }
          );
        }

        if (tasksToRemove.length) {
          await Task.updateMany(
            { _id: { $in: tasksToRemove }, assignedUser: userId },
            { $set: { assignedUser: "", assignedUserName: "unassigned" } }
          );
        }

        return res.status(200).json({ message: "User updated", data: savedUser });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    })

    // DELETE /api/users/:id
    .delete(async (req, res) => {
      try {
        const id = req.params.id;
        const user = await User.findById(id);
        if (!user) {
          return res.status(404).json({ message: "User not found", data: {} });
        }

        // Unassign all tasks belonging to this user
        await Task.updateMany(
          { assignedUser: id },
          { $set: { assignedUser: "", assignedUserName: "unassigned" } }
        );

        await User.deleteOne({ _id: id });

        return res.status(200).json({ message: "User deleted", data: {} });

      } catch (err) {
        return res.status(500).json({ message: "Server Error", data: err });
      }
    });

  return router;
};
