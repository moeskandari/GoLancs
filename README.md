# Lancaster Travel Routes Application

A web application for generating and displaying travel routes in Lancaster, Preston, Blackpool, and the Fylde and Wyre coast regions. The application provides an interactive map interface with real-time route planning capabilities.

## Project Overview

This application helps users find the best travel routes using various transportation methods including bus, rail, road, and walking. It features an intuitive interface with real-time data integration and weather information to assist in journey planning.

### Key Features

- **Interactive Map**: Confined to Lancaster, Preston, Blackpool, and Fylde/Wyre coast regions
- **Route Planning**: Start and destination search with automatic location detection
- **Multi-Modal Transportation**: Support for bus, rail, road, and walking routes
- **Real-Time Data**: Integration with local transportation authorities
- **Weather Integration**: Current weather information to inform travel decisions
- **Responsive Design**: Works on both desktop and mobile devices
- **Accessibility**: Designed with accessibility standards in mind

## Technology Stack

### Frontend
- **React** (v18.2.0) - UI framework
- **React Leaflet** (v4.2.1) - Interactive maps
- **Leaflet** (v1.9.4) - Mapping library
- **Axios** (v1.6.0) - HTTP client

### Backend
- **Node.js** - Runtime environment
- **Express** (v4.18.2) - Web framework
- **PostgreSQL** - Database for transportation data
- **CORS** - Cross-origin resource sharing

### Infrastructure
- **Podman** - Container runtime
- **GitHub Actions** - CI/CD automation

## Project Structure

```
.
├── backend/              # Node.js backend server
│   ├── server.js        # Main server file
│   ├── package.json     # Backend dependencies
│   └── .env.example     # Environment variables template
├── frontend/            # React frontend application
│   ├── public/         # Static files
│   ├── src/            # Source code
│   │   ├── components/ # React components
│   │   │   ├── MapView.js          # Interactive map
│   │   │   ├── SearchBar.js        # Location search
│   │   │   ├── BottomControls.js   # Filter/Location/Account buttons
│   │   │   └── Compass.js          # Directional compass
│   │   ├── App.js      # Main application component
│   │   └── index.js    # Entry point
│   └── package.json    # Frontend dependencies
├── postgres/           # Database scripts and data
└── README.md          # This file
```

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Podman (for containerized deployment)
- PostgreSQL (v13 or higher)
- Git

### Local Development Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/lewisb2606/Group1-200-Project.git
cd Group1-200-Project
```

#### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm start
```

The backend server will run on `http://localhost:5000`

For development with auto-reload:
```bash
npm run dev
```

#### 3. Frontend Setup

```bash
cd frontend
npm install
npm start
```

The frontend will run on `http://localhost:3000`

### Running with Podman Containers

The application is fully containerized with Podman. Three main services run in containers:

#### Quick Start (Recommended)
```bash
# Interactive setup guide
./scripts/quickstart.sh
```

#### Using Podman Compose (Easiest)
```bash
# Requires: pip install podman-compose
podman-compose up -d

# View logs
podman-compose logs -f

# Stop all services
podman-compose down
```

#### Using Provided Scripts
```bash
# Build all container images
./scripts/build_containers.sh

# Start all containers (PostgreSQL, Backend, Frontend)
./scripts/run_all_containers.sh

# Stop all containers
./scripts/cleanup_containers.sh
```

#### Access Services
Once running:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000/api/health
- **Database**: localhost:5050

For detailed container instructions, see [CONTAINERIZATION.md](CONTAINERIZATION.md)

## Current Implementation Status

### ✅ Implemented Features

1. **Interactive Map**
   - Confined to specified geographical region
   - Responsive zoom and pan controls
   - OpenStreetMap tile layer

2. **Search Functionality**
   - Start location search bar with auto-location detection
   - Destination search bar
   - Geolocation API integration

3. **User Interface**
   - Three bottom control buttons (placeholders):
     - Filter options
     - Center on location
     - Account settings
   - Interactive compass in top-right corner
   - Responsive design for mobile and desktop

### 🚧 To Be Implemented

- Route calculation and display
- Real-time transportation data integration
- Weather API integration
- Database connectivity
- User authentication
- Filter functionality
- Route preferences (fastest, shortest, etc.)
- Multi-modal route options
- Stop information display
- Containerized deployment

## API Endpoints

### Current Endpoints

- `GET /api/health` - Health check
- `POST /api/routes` - Route planning (placeholder)
- `GET /api/transport` - Transportation data (placeholder)

### Planned Endpoints

- `GET /api/weather` - Weather information
- `GET /api/routes/bus` - Bus routes
- `GET /api/routes/rail` - Rail routes
- `GET /api/routes/walking` - Walking routes
- `POST /api/user/preferences` - User preferences

## Data Sources

### Transportation Data
- **Real-time**: scc.transport.lancs.ac.uk
- **Static**: PostgreSQL database with local transportation data

### Weather Data
- OpenWeatherMap API or WeatherAPI (to be integrated)

## Development Workflow

### Version Control

- Main branch: `main` (protected)
- Feature branches: `feature/<feature-name>`
- Bug fixes: `bugfix/<bug-name>`

### Git Workflow

1. Create feature branch from `main`
2. Implement changes with clear commit messages
3. Test thoroughly
4. Submit for team review
5. Merge after approval

### Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Example:
```
feat: add interactive map with region boundaries

- Implemented Leaflet map component
- Set geographical bounds for Lancaster region
- Added compass component for navigation
```

## Testing

(To be implemented)

```bash
# Frontend tests
cd frontend
npm test

# Backend tests
cd backend
npm test
```

## Deployment

### GitHub Actions

CI/CD pipeline will be configured to:
1. Run automated tests
2. Build containers
3. Deploy to staging/production

## Accessibility

The application follows WCAG 2.1 Level AA guidelines:
- Keyboard navigation support
- Screen reader compatibility
- High contrast mode
- Responsive text sizing
- ARIA labels on interactive elements

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing

1. Ensure all code is well-documented
2. Follow existing code style
3. Write clear commit messages
4. Test on multiple devices/browsers
5. Submit for team review before pushing to main

## Team

Group 1 - SCC200 Project

## License

This is a private repository. Unauthorized access or distribution is prohibited.

## Support

For issues or questions, please contact the development team or create an issue in the GitHub repository.

---

**Note**: This is an active development project. Features and documentation are continuously updated.
