/* ================================================================
   GOOGLE NATIVE SIGN-IN — SETUP GUIDE (laptop jaisa account chooser)
   ----------------------------------------------------------------
   PROBLEM: WebView (MainActivity) ek isolated mini-browser hai — uske
   paas Chrome ke Google cookies NAHI hote aur wo phone ke
   Settings > Accounts > Google ko dekh NAHI sakta. Isliye pehli baar
   "Sign in with Google" hamesha khaali lagta tha.

   FIX (is repo mein already implemented):
     1) CredentialManager (GoogleAuth.kt) → SYSTEM account chooser
        (wahi list jo Gmail / Play Store dikhate hain).
     2) Google ID token → backend/auth.js signInWithCredential →
        Firebase session.
     3) Fail / cancel → Custom Tab fallback (Chrome cookies share) →
        phir bhi na ho → purana WebView redirect (pehle jaisa).

   SISTEMA COMO HACERLO FUNCIONAR (sirf 2 cheezein karni hain):
   ----------------------------------------------------------------
   STEP 1 — Firebase Console mein Android app + SHA-1 register karo:
     a) Firebase Console → Project settings → Your apps → Add app → Android
        • Package name: com.achiva.app
        • SHA-1: keystore ka fingerprint (neeche Step 3 dekho)
     b) google-services.json download karo (APK build ke liye zaroori NAHI
        hai — sirf Console mein SHA-1 register hona zaroori hai).

   STEP 2 — Web client ID nikalo aur yahan paste karo (2 jagah me se 1):
     Firebase Console → Authentication → Sign-in method → Google →
     "Web SDK configuration" → "Web client ID" copy karo
     (dikhega: 698527829835-xxxx.apps.googleusercontent.com)

     OPTION A (easy, recommended): index.html mein paste karo:
       window.ACHIVA_GOOGLE_WEB_CLIENT_ID = "698527829835-xxxx.apps.googleusercontent.com";

     OPTION B (APK build time): gradle property se do:
       gradle assembleDebug -PgoogleWebClientId=698527829835-xxxx.apps.googleusercontent.com

     Dono khaali rahe to app pehle jaise chalegi (WebView redirect) —
     crash NAHI hogi, bas account chooser nahi aayega.

   STEP 3 — SHA-1 fingerprint nikalo (Step 1a ke liye):
     Build APK workflow ke baad log mein "APK verify" step SHA-256
     print karta hai. SHA-1 ke liye local mein:
       keytool -list -v -keystore android-app/app/achiva.keystore -alias achiva -storepass achiva123
     Usme "SHA1:" wali line Firebase Console → Project settings → Android
     app → "Add fingerprint" mein paste karo.

   STEP 4 — Build + test:
     • Commit/push → "Build APK" workflow → naya APK install karo.
     • Phone mein Settings > Accounts mein 2 Google accounts rakho,
       Chrome se logout karke bhi test karo.
     • App → Sign in with Google → SYSTEM chooser mein dono accounts
       dikhne chahiye (type karne ki zaroorat nahi).
     • Cancel dabao → kuch nahi hota (pehle jaisa redirect nahi ataktaa).
     • Play Services off / koi account nahi → Chrome Custom Tab khulta hai.

   REGRESSION SAFETY:
     • Purana APK (bina GoogleAuth.kt) + nayi website → purana redirect
       flow (fallbackWebGoogle) — login toot-ta NAHI.
     • Naya APK + Web client ID khaali → purana redirect flow.
     • Desktop/laptop browser → popup flow (unchanged).
   ================================================================ */
