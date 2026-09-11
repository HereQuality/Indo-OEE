# MERN Role-Based Access Control Platform

A comprehensive full-stack admin platform built with the MERN stack (MongoDB, Express, React, Node.js). This project provides a robust foundation for building applications with dynamic, menu-driven Role-Based Access Control (RBAC), hierarchical user management, and secure JWT authentication.

## Features

- **Dynamic RBAC**: Create and manage roles, and dynamically assign read/write permissions to specific application menus and routes.
- **Hierarchical Management**: Visualize and manage user reporting structures with a hierarchical team view.
- **Secure Authentication**: Robust JWT-based authentication system for both Admin and standard user access.
- **Impersonation/Access Panel**: Authorized users can safely preview the application from the perspective of their subordinates.
- **Responsive Dashboard**: A modern, responsive React frontend built with Vite and Tailwind CSS.

## Technology Stack

- **Frontend**: React, Vite, Tailwind CSS
- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Mongoose)
- **Authentication**: JSON Web Tokens (JWT)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (v9 or higher)
- MongoDB instance (local or Atlas)

```bash
lsof -i :5000 | grep LISTEN
kill -9 <PID>
```
### Backend Setup

1. Navigate to the server directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   Copy `.env.example` to `.env` and fill in your connection details (e.g., `MONGO_URI`, `JWT_SECRET`).
4. Seed the database (Run once for initial setup):
   ```bash
   npm run seed
   ```
5. Start the backend server:
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:5000`.

### Frontend Setup

1. Navigate to the client directory:
   ```bash
   cd client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   Copy `.env.example` to `.env` and ensure `VITE_API_BASE_URL` points to your backend server.
4. Start the frontend development server:
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5173`.

## Architecture Overview

```text
Project_Root/
├── client/          # React frontend application (Vite + Tailwind)
│   ├── src/
│   │   ├── api/     # API integration services
│   │   ├── pages/   # UI pages and views
│   │   └── Routes/  # Protected routing and RBAC enforcement
└── server/          # Node.js + Express backend API
    ├── controllers/ # Request handling logic
    ├── models/      # Mongoose database schemas
    ├── routes/      # API endpoint definitions
    └── middlewares/ # Authentication and permission guards
```

## Permissions Model

The platform utilizes a dual-layer permission enforcement model:
- **Frontend Guard**: UI elements and routes check permissions dynamically to provide immediate feedback and hide unauthorized content.
- **Backend Guard**: API endpoints are strictly protected by middleware that validates the user's role and their specific read/write permissions for the requested resource, ensuring complete security.
# Indo-Pvt-Ltd
