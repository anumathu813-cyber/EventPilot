
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { promisify } = require("util");
const path = require("path");
const db = require("./database");

const scrypt = promisify(crypto.scrypt);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Temporary login sessions
const sessions = new Map();

// Generate secure password hash
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, 64);
    return salt + ":" + key.toString("hex");
}

// Verify password
async function verifyPassword(password, storedHash) {
    const [salt, key] = storedHash.split(":");
    const derivedKey = await scrypt(password, salt, 64);

    return crypto.timingSafeEqual(
        Buffer.from(key, "hex"),
        derivedKey
    );
}

// Authentication middleware
function authenticate(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const userId = token ? sessions.get(token) : null;

    if (!userId) {
        return res.status(401).json({
            message: "Please log in first."
        });
    }

    const user = db.prepare(
        "SELECT id, name, email, role FROM users WHERE id = ?"
    ).get(userId);

    if (!user) {
        return res.status(401).json({
            message: "Invalid session."
        });
    }

    req.user = user;
    next();
}

// Home route
app.get("/api/health", (req, res) => {
    res.json({ message: "EventPilot server is running!" });
});

// Register
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must contain at least 8 characters."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const existingUser = db.prepare(
            "SELECT id FROM users WHERE email = ?"
        ).get(cleanEmail);

        if (existingUser) {
            return res.status(409).json({
                message: "Email already registered."
            });
        }

        // First registered account becomes admin
        const count = db.prepare(
            "SELECT COUNT(*) AS total FROM users"
        ).get().total;

        const role = count === 0 ? "admin" : "member";
        const passwordHash = await hashPassword(password);

        const result = db.prepare(`
            INSERT INTO users (name, email, password, role)
            VALUES (?, ?, ?, ?)
        `).run(name.trim(), cleanEmail, passwordHash, role);

        res.status(201).json({
            message: "Registration successful!",
            userId: result.lastInsertRowid,
            role
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Registration failed."
        });
    }
});

// Login
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Enter email and password."
            });
        }

        const user = db.prepare(
            "SELECT * FROM users WHERE email = ?"
        ).get(email.trim().toLowerCase());

        if (!user || !(await verifyPassword(password, user.password))) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, user.id);

        res.json({
            message: "Login successful!",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Login failed."
        });
    }
});

// Get logged-in user
app.get("/api/me", authenticate, (req, res) => {
    res.json({ user: req.user });
});

// Logout
app.post("/api/logout", authenticate, (req, res) => {
    const token = req.headers.authorization.replace("Bearer ", "");
    sessions.delete(token);

    res.json({ message: "Logged out successfully." });
});

// Get all users for task assignment
app.get("/api/users", authenticate, (req, res) => {
    const users = db.prepare(`
        SELECT id, name, email, role
        FROM users
        ORDER BY name
    `).all();

    res.json(users);
});

// Create event
app.post("/api/events", authenticate, (req, res) => {
    try {
        const { title, description, event_date, location } = req.body;

        if (!title || !event_date) {
            return res.status(400).json({
                message: "Event title and date are required."
            });
        }

        const result = db.prepare(`
            INSERT INTO events
            (title, description, event_date, location, created_by)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            title.trim(),
            description || "",
            event_date,
            location || "",
            req.user.id
        );

        const event = db.prepare(`
            SELECT events.*, users.name AS organizer
            FROM events
            JOIN users ON events.created_by = users.id
            WHERE events.id = ?
        `).get(result.lastInsertRowid);

        io.emit("event-created", event);

        res.status(201).json({
            message: "Event created successfully!",
            event
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Could not create event."
        });
    }
});

// Get all events
app.get("/api/events", authenticate, (req, res) => {
    const events = db.prepare(`
        SELECT events.*, users.name AS organizer
        FROM events
        LEFT JOIN users ON events.created_by = users.id
        ORDER BY events.event_date ASC
    `).all();

    res.json(events);
});

// Create task
app.post("/api/tasks", authenticate, (req, res) => {
    try {
        const {
            title,
            description,
            deadline,
            assigned_to,
            event_id
        } = req.body;

        if (!title || !assigned_to || !event_id) {
            return res.status(400).json({
                message: "Task title, assigned member and event are required."
            });
        }

        const member = db.prepare(
            "SELECT id FROM users WHERE id = ?"
        ).get(assigned_to);

        const event = db.prepare(
            "SELECT id FROM events WHERE id = ?"
        ).get(event_id);

        if (!member || !event) {
            return res.status(404).json({
                message: "Member or event not found."
            });
        }

        const result = db.prepare(`
            INSERT INTO tasks
            (title, description, deadline, assigned_to, event_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            title.trim(),
            description || "",
            deadline || null,
            assigned_to,
            event_id
        );

        const task = db.prepare(`
            SELECT tasks.*,
                   users.name AS assigned_name,
                   events.title AS event_title
            FROM tasks
            JOIN users ON tasks.assigned_to = users.id
            JOIN events ON tasks.event_id = events.id
            WHERE tasks.id = ?
        `).get(result.lastInsertRowid);

        io.emit("task-created", task);

        res.status(201).json({
            message: "Task created successfully!",
            task
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Could not create task."
        });
    }
});

// Get tasks
app.get("/api/tasks", authenticate, (req, res) => {
    const tasks = db.prepare(`
        SELECT tasks.*,
               users.name AS assigned_name,
               events.title AS event_title
        FROM tasks
        LEFT JOIN users ON tasks.assigned_to = users.id
        LEFT JOIN events ON tasks.event_id = events.id
        ORDER BY tasks.created_at DESC
    `).all();

    res.json(tasks);
});

// Update task status
app.patch("/api/tasks/:id/status", authenticate, (req, res) => {
    const { status } = req.body;
    const allowedStatuses = ["Pending", "In Progress", "Completed"];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            message: "Invalid task status."
        });
    }

    const task = db.prepare(
        "SELECT * FROM tasks WHERE id = ?"
    ).get(req.params.id);

    if (!task) {
        return res.status(404).json({
            message: "Task not found."
        });
    }

    if (req.user.role !== "admin" &&
        task.assigned_to !== req.user.id) {
        return res.status(403).json({
            message: "You cannot update this task."
        });
    }

    db.prepare(
        "UPDATE tasks SET status = ? WHERE id = ?"
    ).run(status, req.params.id);

    const updatedTask = db.prepare(`
        SELECT tasks.*,
               users.name AS assigned_name,
               events.title AS event_title
        FROM tasks
        JOIN users ON tasks.assigned_to = users.id
        JOIN events ON tasks.event_id = events.id
        WHERE tasks.id = ?
    `).get(req.params.id);

    io.emit("task-updated", updatedTask);

    res.json({
        message: "Task status updated!",
        task: updatedTask
    });
});

// Socket.IO connection
io.on("connection", (socket) => {
    console.log("EventPilot user connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
    console.log(`EventPilot is running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
