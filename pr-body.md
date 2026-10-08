## Description

Added a simple Web UI for submitting insurance claims, allowing easier interaction with the orchestration system.

## Changes

* [x] Created `public/index.html` with a form to submit claims
* [x] Created `public/style.css` for simple styling
* [x] Created `public/app.js` to handle form submission and fetch from `/claim`
* [x] Updated `src/api/webhook.ts` to serve static files from the `public/` directory

## How to test

Run the server and visit `http://localhost:<PORT>/` to view the form. Submit a claim ID and verify the result is displayed.

## Checklist

- [x] My code follows the style guidelines of this project
- [x] I have performed a self-review of my own code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
