---
description: 'Agent will aid in developing features for the application, including initial setup.'
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']
---
The aim of this project is to create an application to generate travel routes in Lancaster, Preston, Blackpool and the Fylde and Wrye coast. 

This project will take existing data on travel methods including bus, rail, road and walking to create suitable routes from a start and end point input by a user.  

Start and destination locations willl be collected from the user through text and graphical inputs. 

Also present at this stage will be a display of the weather in user’s current location to notify them of any potential travel disruptions. 

The display of the generated routes will feature a map identifying the start and end points of the route, as well as highlighting the route itself. 

Information about each route will be present alongside the map, given an indication to the time each route will take. 

Additional information, such as the number of stops until the user’s destination, will be available to the necessary routes. These generated routes will be able to be sorted according to a preference selected by the user. 

Weather information will again be present at this stage to provide an additional perspective to the user as to which the best route is for their day of journey. 

Technical requirements: 
- This application will be using React for the frontend and Node.js for the backend.
- The application will be using a postgreSQL database to store user data and transportation information.
- We are running the application on podman containers, with the frontend, backend and database running in separate containers.
- We want to use a github repo to store our code and use github actions to automate our testing and deployment processes.
- We will want it to be multi-platform, so it can be used on both desktop and mobile devices.
- Weather information will be sourced from a reliable API, such as OpenWeatherMap or WeatherAPI.
- Transportation data will be sourced from local transportation authorities, real-time data will be pulled from scc.transport.lancs.ac.uk, more static data will be from the postgresql database.
- The application will be designed with accessibility in mind, ensuring it is usable by people with disabilities.
- Backend will be stored in ./backend and frontend in ./frontend in the github repo.
- We need to pull and rebuild the containers whenever we boot up computers because we are on lab machines.
- Only ports 5000-5100 are available for use, so we will need to ensure our application runs within this range.

Rules: 
- Before git push commands, wait for a review from the team to ensure code quality and consistency. Wait for approval before pushing to the main branch.
- Ensure that all code is well-documented and follows best practices for readability and maintainability.
- Github repo should be organized with clear folder structures for frontend and backend, and include a README file with instructions for setup and usage.
- Repo must be private to protect sensitive information and ensure that only authorized team members have access to the codebase.
- This agent must also be on the repo to ensure that it can be easily accessed and updated by the team as needed.
- The link to our empty github repo is https://github.com/lewisb2606/Group1-200-Project.git
- We want good version control, so regular commits with clear messages should be made to track changes and progress effectively.
- To avoid issues, use multiple branches for different features or stages of development, and merge them into the main branch only after thorough testing and review.


