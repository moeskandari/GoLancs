# Backend

Node.js backend server for the Lancaster Travel Routes application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

- `GET /api/health` - Health check endpoint
- `POST /api/routes` - Route planning (to be implemented)
- `GET /api/transport` - Transportation data (to be implemented)
