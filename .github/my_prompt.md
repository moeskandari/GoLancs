We need to initialise our profile page 

This includes with heavy empahsis:
    - Uploading the created files to the provided repo 
    - Initialise back-end. 
    - Create front end.
    - make sure all the code only effect the front-end e.g.UI
    - Once these features, and only these features are implemented, wait for the features to be signed off and tested so later it can be added to a new branch on the github repo known as UI 

For the front end:
    - make the account button at the bottom of the screen intractive, so when the user press on the button:
    - if the user is not logged in already it should take them to a sign in page with a link toa account creation page if they dont have an account
    - for the log in page: 
        - the login page should be an overlay off the existing map 
        - Centered of their current page with respect to the screen size and the aspect ratio of their screen 
        - the layout for the text fields and buttons should be stacked underneath each other ranging form top to the bottom with the containing fields:
        - the title of the page should be sign in 
        - Text field: Email
        - Text field: Password
        - Button: “Sign in”, after the user successfully signed in take them to a profile page wich we will implement later currently add a basic back button on the top left of the profile page so when the user press take them to the main landing page 
        - Link text below button: “Forgot password?”, make this button currently empty, it should not do anything 
        Navigation
        “Sign in” button submits the form. it should not do anythig and we will update it later 
        “Forgot password?” navigates to password reset. it should not do anythig and we will update it later 
    - for the sign up page:
        - take the same style as the log in page with the changes:
        - Sign up as the title of the page 
        - Text field: First name
        - Text field: Last name
        - Text field: Email
        - Text field: Password
        - Text field: Retype Password 
        - Button: “Create your account”
        - Small text line: “By creating an account, you agree to” and a link to the “Terms” the link should not do anythig and we will update it later
        - Small text line: “Already have an account?” and a link to the “Sign in” which will take the user back to the sign in page if pressed
        -Navigation:
            - when user presses on “Create your account” button submits the form which wil be later updated by the backend procccess
            - when user presses on “Sign in” it takes them to the Sign in screen

Please make sure to follow all rules that we have set out and follow all instructions we have given to you especially the this includes section