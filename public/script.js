
const API = "/api";

let token = sessionStorage.getItem("eventpilotToken");
let currentUser = null;

let events = [];
let tasks = [];
let users = [];

let socket = null;

const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");
const authMessage = document.getElementById("authMessage");

// ========================================
// AUTHENTICATION
// ========================================

function showAuth(type) {
    document.getElementById("loginForm")
        .classList.toggle("hidden", type !== "login");

    document.getElementById("registerForm")
        .classList.toggle("hidden", type !== "register");

    authMessage.textContent = "";
}

async function apiRequest(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(API + url, {
        ...options,
        headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.message || data.error || "Something went wrong."
        );
    }

    return data;
}

// REGISTER

document.getElementById("registerForm")
.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;

    try {
        await apiRequest("/register", {
            method: "POST",
            body: JSON.stringify({ name, email, password })
        });

        const result = await apiRequest("/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        token = result.token;

        sessionStorage.setItem("eventpilotToken", token);

        await startApplication();

        showNotification("Welcome to EventPilot!");

    } catch (error) {
        authMessage.textContent = error.message;
    }
});

// LOGIN

document.getElementById("loginForm")
.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
        const result = await apiRequest("/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        token = result.token;

        sessionStorage.setItem("eventpilotToken", token);

        await startApplication();

        showNotification("Login successful!");

    } catch (error) {
        authMessage.textContent = error.message;
    }
});

// ========================================
// START APPLICATION
// ========================================

async function startApplication() {
    try {
        const result = await apiRequest("/me");

        currentUser = result.user;

        if (!currentUser) {
            throw new Error("User information not found.");
        }

        authScreen.classList.add("hidden");
        appScreen.classList.remove("hidden");

        updateUserDetails();

        connectSocket();

        await loadAllData();

        navigate("dashboard");

    } catch (error) {
        console.error("Application startup error:", error);

        token = null;
        currentUser = null;

        sessionStorage.removeItem("eventpilotToken");

        appScreen.classList.add("hidden");
        authScreen.classList.remove("hidden");

        authMessage.textContent =
            "Please log in again. " + error.message;
    }
}

// USER DETAILS

function updateUserDetails() {
    const name = currentUser.name || "Student";
    const role = currentUser.role || "member";

    document.getElementById("userName").textContent = name;

    document.getElementById("sidebarUserName").textContent = name;

    document.getElementById("sidebarUserRole").textContent = role;

    document.getElementById("userAvatar").textContent =
        name.charAt(0).toUpperCase();
}

// ========================================
// NAVIGATION
// ========================================

function navigate(page) {
    document.querySelectorAll(".page").forEach(section => {
        section.classList.remove("active");
        section.classList.add("hidden");
    });

    const selectedPage = document.getElementById(page);

    if (!selectedPage) return;

    selectedPage.classList.remove("hidden");
    selectedPage.classList.add("active");

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === page
        );
    });

    const titles = {
        dashboard: "Dashboard",
        events: "Events",
        tasks: "Tasks",
        team: "Team Members",
        calendar: "Calendar"
    };

    document.getElementById("pageTitle").textContent =
        titles[page] || "Dashboard";
}

document.querySelectorAll(".nav-btn").forEach(button => {
    button.addEventListener("click", () => {
        navigate(button.dataset.page);
    });
});

// ========================================
// FORM CONTROLS
// ========================================

function openForm(id) {
    document.getElementById(id).classList.remove("hidden");
}

function closeForm(id) {
    document.getElementById(id).classList.add("hidden");
}

// ========================================
// LOAD ALL DATA
// FIXED ARRAY RESPONSE
// ========================================

async function loadAllData() {
    const results = await Promise.all([
        apiRequest("/events"),
        apiRequest("/tasks"),
        apiRequest("/users")
    ]);

    // Supports both direct arrays and object responses

    events = Array.isArray(results[0])
        ? results[0]
        : (results[0].events || []);

    tasks = Array.isArray(results[1])
        ? results[1]
        : (results[1].tasks || []);

    users = Array.isArray(results[2])
        ? results[2]
        : (results[2].users || []);

    renderEvents();
    renderTasks();
    renderTeam();
    renderDashboard();
    renderCalendar();

    updateTaskFormOptions();
}

// ========================================
// CREATE EVENT
// ========================================

document.getElementById("eventForm")
.addEventListener("submit", async (e) => {
    e.preventDefault();

    const eventData = {
        title: document.getElementById("eventTitle").value.trim(),
        description: document.getElementById("eventDescription").value.trim(),
        event_date: document.getElementById("eventDate").value,
        location: document.getElementById("eventLocation").value.trim()
    };

    try {
        await apiRequest("/events", {
            method: "POST",
            body: JSON.stringify(eventData)
        });

        e.target.reset();

        closeForm("eventForm");

        await loadAllData();

        showNotification("Event created successfully!");

    } catch (error) {
        showNotification(error.message);
    }
});

// DISPLAY EVENTS

function renderEvents() {
    const container = document.getElementById("eventsList");

    if (!events.length) {
        container.innerHTML =
            "<p>No events available. Create your first event!</p>";
        return;
    }

    container.innerHTML = events.map(event => `
        <article class="event-card">

            <span class="status-badge">College Event</span>

            <h3>${escapeHTML(event.title)}</h3>

            <p>${escapeHTML(
                event.description || "No description provided."
            )}</p>

            <p>📅 ${formatDate(event.event_date)}</p>

            <p>📍 ${escapeHTML(
                event.location || "Location not specified"
            )}</p>

            <p>Created by: ${escapeHTML(
                event.creator_name || "Student"
            )}</p>

        </article>
    `).join("");
}

// ========================================
// TASK FORM OPTIONS
// ========================================

function updateTaskFormOptions() {
    const memberSelect = document.getElementById("taskMember");
    const eventSelect = document.getElementById("taskEvent");

    memberSelect.innerHTML =
        '<option value="">Select team member</option>';

    users.forEach(user => {
        memberSelect.innerHTML += `
            <option value="${Number(user.id)}">
                ${escapeHTML(user.name)}
                (${escapeHTML(user.role)})
            </option>
        `;
    });

    eventSelect.innerHTML =
        '<option value="">Select event</option>';

    events.forEach(event => {
        eventSelect.innerHTML += `
            <option value="${Number(event.id)}">
                ${escapeHTML(event.title)}
            </option>
        `;
    });
}

// ========================================
// CREATE TASK
// ========================================

document.getElementById("taskForm")
.addEventListener("submit", async (e) => {
    e.preventDefault();

    const memberValue =
        document.getElementById("taskMember").value;

    const eventValue =
        document.getElementById("taskEvent").value;

    const taskData = {
        title: document.getElementById("taskTitle").value.trim(),

        description:
            document.getElementById("taskDescription").value.trim(),

        deadline:
            document.getElementById("taskDeadline").value,

        assigned_to: memberValue ? Number(memberValue) : null,

        event_id: eventValue ? Number(eventValue) : null
    };

    try {
        await apiRequest("/tasks", {
            method: "POST",
            body: JSON.stringify(taskData)
        });

        e.target.reset();

        closeForm("taskForm");

        await loadAllData();

        showNotification("Task created successfully!");

    } catch (error) {
        showNotification(error.message);
    }
});

// ========================================
// DISPLAY TASKS
// FIXED ASSIGNED NAME FIELD
// ========================================

function renderTasks() {
    const container = document.getElementById("tasksList");

    if (!tasks.length) {
        container.innerHTML =
            "<p>No tasks available. Create your first task!</p>";
        return;
    }

    container.innerHTML = tasks.map(task => {

        const canUpdate =
            currentUser &&
            (
                currentUser.role === "admin" ||
                Number(task.assigned_to) === Number(currentUser.id)
            );

        const assignedName =
            task.assigned_name ||
            task.assignee_name ||
            "Not assigned";

        return `
            <article class="task-card">

                <span class="status-badge">
                    ${escapeHTML(task.status)}
                </span>

                <h3>${escapeHTML(task.title)}</h3>

                <p>
                    ${escapeHTML(
                        task.description || "No description provided."
                    )}
                </p>

                <p>
                    👤 Assigned to:
                    ${escapeHTML(assignedName)}
                </p>

                <p>
                    📅 Deadline:
                    ${task.deadline
                        ? formatDate(task.deadline)
                        : "Not set"}
                </p>

                <p>
                    🎯 Event:
                    ${escapeHTML(task.event_title || "No event")}
                </p>

                ${canUpdate ? `
                    <select
                        class="status-select"
                        onchange="updateTaskStatus(
                            ${Number(task.id)},
                            this.value
                        )"
                    >

                        <option value="Pending"
                            ${task.status === "Pending" ? "selected" : ""}>
                            Pending
                        </option>

                        <option value="In Progress"
                            ${task.status === "In Progress" ? "selected" : ""}>
                            In Progress
                        </option>

                        <option value="Completed"
                            ${task.status === "Completed" ? "selected" : ""}>
                            Completed
                        </option>

                    </select>
                ` : ""}

            </article>
        `;

    }).join("");
}

// ========================================
// UPDATE TASK STATUS
// ========================================

async function updateTaskStatus(id, status) {
    try {
        await apiRequest(`/tasks/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });

        await loadAllData();

        showNotification("Task status updated!");

    } catch (error) {
        showNotification(error.message);

        await loadAllData();
    }
}

// ========================================
// TEAM MEMBERS
// ========================================

function renderTeam() {
    const container = document.getElementById("teamList");

    if (!users.length) {
        container.innerHTML =
            "<p>No team members found.</p>";
        return;
    }

    container.innerHTML = users.map(user => `
        <article class="team-card">

            <div class="avatar">
                ${escapeHTML(user.name.charAt(0).toUpperCase())}
            </div>

            <h3>${escapeHTML(user.name)}</h3>

            <p>${escapeHTML(user.email)}</p>

            <span class="status-badge">
                ${escapeHTML(user.role)}
            </span>

        </article>
    `).join("");
}

// ========================================
// DASHBOARD
// ========================================

function renderDashboard() {
    document.getElementById("totalEvents").textContent =
        events.length;

    document.getElementById("totalTasks").textContent =
        tasks.length;

    document.getElementById("pendingTasks").textContent =
        tasks.filter(task => task.status === "Pending").length;

    document.getElementById("completedTasks").textContent =
        tasks.filter(task => task.status === "Completed").length;

    const activity =
        document.getElementById("recentActivity");

    const recent = [
        ...events.map(event => ({
            title: `Event created: ${event.title}`,
            date: event.created_at
        })),

        ...tasks.map(task => ({
            title: `Task created: ${task.title}`,
            date: task.created_at
        }))
    ]
    .sort((a, b) =>
        new Date(b.date) - new Date(a.date)
    )
    .slice(0, 6);

    activity.innerHTML = recent.length
        ? recent.map(item => `
            <div class="calendar-item">

                <div class="calendar-date">📌</div>

                <div>
                    <strong>${escapeHTML(item.title)}</strong>

                    <p>
                        ${item.date
                            ? formatDateTime(item.date)
                            : "Recently"}
                    </p>
                </div>

            </div>
        `).join("")
        : "<p>No activities yet.</p>";
}

// ========================================
// CALENDAR
// ========================================

function renderCalendar() {
    const container =
        document.getElementById("calendarList");

    const items = [
        ...events.map(event => ({
            title: event.title,
            date: event.event_date,
            type: "Event"
        })),

        ...tasks
            .filter(task => task.deadline)
            .map(task => ({
                title: task.title,
                date: task.deadline,
                type: "Task deadline"
            }))
    ]
    .sort((a, b) =>
        new Date(a.date) - new Date(b.date)
    );

    if (!items.length) {
        container.textContent =
            "No upcoming activities.";
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="calendar-item">

            <div class="calendar-date">
                ${formatShortDate(item.date)}
            </div>

            <div>
                <strong>${escapeHTML(item.title)}</strong>

                <p>
                    ${item.type} · ${formatDate(item.date)}
                </p>
            </div>

        </div>
    `).join("");
}

// ========================================
// REAL-TIME SOCKET.IO
// ========================================

function connectSocket() {
    if (socket) {
        socket.disconnect();
    }

    socket = io();

    socket.on("connect", () => {
        document.getElementById("liveStatus").textContent =
            "🟢 Live Connected";
    });

    socket.on("disconnect", () => {
        document.getElementById("liveStatus").textContent =
            "🔴 Disconnected";
    });

    socket.on("event-created", async () => {
        await loadAllData();
        showNotification("A new event was created!");
    });

    socket.on("task-created", async () => {
        await loadAllData();
        showNotification("A new task was created!");
    });

    socket.on("task-updated", async () => {
        await loadAllData();
        showNotification("A task was updated!");
    });
}

// ========================================
// NOTIFICATIONS
// ========================================

function showNotification(message) {
    const area =
        document.getElementById("notificationArea");

    const item = document.createElement("div");

    item.className = "notification";
    item.textContent = message;

    area.appendChild(item);

    setTimeout(() => {
        item.remove();
    }, 4000);
}

// ========================================
// HELPERS
// ========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatDate(value) {
    if (!value) return "Not set";

    const date = new Date(value + "T00:00:00");

    return Number.isNaN(date.getTime())
        ? escapeHTML(value)
        : date.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        });
}

function formatDateTime(value) {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "Recently"
        : date.toLocaleString("en-IN");
}

function formatShortDate(value) {
    const date = new Date(value + "T00:00:00");

    return Number.isNaN(date.getTime())
        ? "--"
        : date.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short"
        });
}

// ========================================
// LOGOUT
// ========================================

document.getElementById("logoutBtn")
.addEventListener("click", async () => {

    try {
        await apiRequest("/logout", {
            method: "POST"
        });
    } catch (error) {
        // Clear local session even if server is unavailable.
    }

    if (socket) {
        socket.disconnect();
    }

    token = null;
    currentUser = null;

    sessionStorage.removeItem("eventpilotToken");

    appScreen.classList.add("hidden");
    authScreen.classList.remove("hidden");

    document.getElementById("loginForm").reset();
    document.getElementById("registerForm").reset();

    showAuth("login");
});

// ========================================
// RESTORE SESSION
// ========================================

if (token) {
    startApplication();
} else {
    showAuth("login");
}