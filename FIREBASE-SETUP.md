# ClearTrack + Firebase (free Spark plan) – setup guide

Do these in order. Total time: about 15 minutes. No credit card needed.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. **Create a project** → name it `oc-cleartrack` → turn Google Analytics **off** → Create.
3. Stay on the free **Spark** plan. Never click "Upgrade".

## 2. Register the web app and copy the config
1. Project home → click the **</>** (Web) icon → nickname `cleartrack` → leave "Firebase Hosting" unchecked → Register app.
2. Copy the `firebaseConfig = { ... }` values.
3. Open `js/firebase-config.js` and paste them over the placeholders.

## 3. Turn on sign-in
Build → **Authentication** → Get started → **Email/Password** → Enable → Save.

## 4. Create the database and the rules
1. Build → **Firestore Database** → Create database → choose a location near you (e.g. `asia-southeast1`, Singapore) → **Production mode** → Create.
2. Open the **Rules** tab, delete everything, paste the whole content of `firestore.rules`, click **Publish**.
3. Optional: open the **Data** tab → Start collection → Collection ID `config` → Document ID `app` → field `deadline` (string) = `2026-11-30` → Save.
   This is the **school-wide fallback deadline**, used for any office whose staff have not set their own date. (If you skip this, the app uses 2026-11-30.)

## 5. Turn on the reset-PIN email link
Authentication → **Sign-in method** → **Email/Password** → switch ON **Email link (passwordless sign-in)** → Save.
(No "Customize action URL" is needed. The email link opens `reset-pin.html` by itself.)

Also Authentication → **Settings** → **Authorized domains** → add your deployed domain
(for example `yourname.github.io` or `your-app.vercel.app`). `localhost` is already there.

## 6. Create staff accounts (students sign up themselves, staff do not)
Do this once per office. Example: Library.
1. Authentication → **Users** → **Add user** → email `library.staff@olivarezcollege.edu.ph`, password `1234-oc`
   (the app adds `-oc` after the 4-digit PIN, so PIN `1234` = password `1234-oc`). Copy the **User UID**.
2. Firestore → Data → collection `users` → **Add document** → Document ID = the UID you copied. Fields (all strings):
   - `email` = `library.staff@olivarezcollege.edu.ph`
   - `name` = `Library Staff`
   - `role` = `staff`
   - `office` = `library`
3. Repeat for `accounting`, `osa`, `registrar`, `it`, `dean` if you need them.

## 7. Run it
Open the folder in VS Code → Live Server → **http://localhost:5500** (use `localhost`, not `127.0.0.1`).
1. Sign up a student with an `@olivarezcollege.edu.ph` email and a 4-digit PIN.
2. Optional: in Firestore, open that student's `users/{uid}` document and add `studentId` = `251C-99` (uppercase) so staff can search by ID.
3. Sign out, sign in as the Library staff, search the student's email, set a status → Save.
4. Sign in as the student again: the new status and notification appear.

## 8. Deadlines and group updates (Staff Portal)
- **Office deadline:** at the top of the Staff Portal, staff pick a date and click **Save deadline**. It applies only to their office and appears next to that office on every student's Home, Offices and Office Information pages. The first save creates the `offices/{officeId}` document by itself, so there is nothing to set up in the console.
- **Many students:** switch to **Many students**, choose a course and/or year level (or leave both on "All"), pick the status, requirement and message, and click **Review and apply**. A confirmation shows how many students will be changed. By default, students who are already cleared are skipped.
- **Free-plan limit:** each student costs about 2 writes and Firebase's free plan allows 20,000 writes per day, so a few hundred students per office per day is fine. Updates go out in batches and shrink automatically if Firebase refuses a big batch.
- **After updating the files, publish `firestore.rules` again** (step 4). The new rules let staff write their own office's deadline.

## 9. Deploy (free)
- **Vercel**: push the folder to GitHub → vercel.com → Add New Project → import → Deploy.
- **GitHub Pages**: repo Settings → Pages → deploy from the `main` branch.
Then do the two "deployed domain" updates from step 5.

---

## What is different from the demo (be ready to explain)
| Demo | With Firebase | Why |
|---|---|---|
| 4-digit PIN is the password | Real password = PIN + `-oc` | Firebase needs 6+ characters. Users still type 4 digits. |
| "Verification code" in Forgot PIN | Firebase emails a **reset link**; `reset-pin.html` then asks for the new PIN | Emailed 6-digit codes need paid Cloud Functions. |
| "No account found for this email" | Same "check your email" message for every email | Stops strangers from testing which emails have accounts. |
| Search by name, email or ID | Search by exact email or exact student ID (or update a whole course/year at once) | Firestore has no "contains" search. |
| Staff accounts built in | Staff created by you in the console (step 6) | Anyone can sign up, so staff must not be self-service. |

## Security notes
- The `apiKey` in the config is not a secret. The **rules** protect the data: students read only their own records, staff can change only their own office, and sign-up always creates a `student`.
- A 4-digit PIN has only 10,000 combinations. Firebase throttles repeated wrong attempts, which is acceptable for a school prototype, not for production.
- Free plan limits (50k reads/day, 20k writes/day) are far above what a class demo uses.

## If something does not work
- Red message "Firebase is not set up yet" → `js/firebase-config.js` still has the placeholders.
- "Email/Password sign-in is not enabled" → step 3.
- "You do not have permission" → rules not published (step 4), or the staff `users/{uid}` document is missing/mistyped (step 6).
- Forgot PIN says the website address is not allowed, or the email never comes → step 5 (Email link ON) and Authorized domains (add `jelo1.github.io` and `localhost`).
- Open the browser console (F12) to see the exact error.
