
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "eventpilot.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Users table
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Events table
db.exec(`
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    event_date TEXT NOT NULL,
    location TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
`);

// Tasks table
db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    deadline TEXT,
    status TEXT DEFAULT 'Pending',
    assigned_to INTEGER,
    event_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
);
`);

// Notifications table
db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// Insert sample events only once
const eventCount = db.prepare(
    "SELECT COUNT(*) AS count FROM events"
).get().count;

if (eventCount === 0) {
    const addEvent = db.prepare(`
        INSERT INTO events (title, description, event_date, location)
        VALUES (?, ?, ?, ?)
    `);

    addEvent.run(
        "Tech Innovation Day",
        "Showcase innovative technology ideas.",
        "2026-11-20",
        "College Auditorium"
    );

    addEvent.run(
        "Web Development Workshop",
        "Learn modern web development.",
        "2026-11-24",
        "Computer Lab"
    );

    addEvent.run(
        "Student Project Expo",
        "Present student projects and creative solutions.",
        "2026-12-05",
        "Seminar Hall"
    );
}

// Insert sample tasks only once
const taskCount = db.prepare(
    "SELECT COUNT(*) AS count FROM tasks"
).get().count;

if (taskCount === 0) {
    const events = db.prepare(
        "SELECT id FROM events ORDER BY id"
    ).all();

    if (events.length >= 3) {
        const addTask = db.prepare(`
            INSERT INTO tasks
            (title, description, deadline, status, event_id)
            VALUES (?, ?, ?, ?, ?)
        `);

        addTask.run(
            "Prepare event poster",
            "Design the Tech Innovation Day poster.",
            "2026-11-12",
            "Pending",
            events[0].id
        );

        addTask.run(
            "Prepare workshop materials",
            "Collect workshop learning materials.",
            "2026-11-18",
            "In Progress",
            events[1].id
        );

        addTask.run(
            "Arrange project exhibition",
            "Prepare the project exhibition area.",
            "2026-11-28",
            "Completed",
            events[2].id
        );
    }
}

console.log("Sample events and tasks are ready!");
console.log("EventPilot database is ready!");

module.exports = db;
