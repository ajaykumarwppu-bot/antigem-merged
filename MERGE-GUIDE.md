# 🚀 AntiGem Achiva — Merge Guide

**Kya bana:** AntiGem + Achiva dono apps ka merge — ek single app jisme Achiva
tumhari productivity app ka **5th built-in screen** hai (Chat, IDE, Terminal, Browser ke saath).

**Package ID:** `com.antigem.achiva` (termux flavor: `com.termux.achiva`)
→ **Original AntiGem se bilkul alag app** — side-by-side install hongi, original untouched rahegi.

---

## 📁 Kya-kya change hua (6 cheezein)

| File | Change |
|---|---|
| `app/build.gradle.kts` | ApplicationId → `com.antigem.achiva` / `com.termux.achiva` |
| `app/src/main/res/values/strings.xml` | App name → **"AntiGem Achiva"** |
| `MainActivity.kt` | `AppViewMode.ACHIVA` + persistent screen + navigation |
| `ui/chat/ChatScreen.kt` | Chat header me **naya ✓ (Achiva) button** |
| `ui/achiva/AchivaScreen.kt` | **Nayi file** — WebView screen (AssetLoader, sign-in cookies, back handling, error retry) |
| `app/src/main/assets/achiva/` | **Achiva ka poora web app bundled** (2.2 MB, offline backup ke liye) |
| `version.json` | v1.0.19 (code 119) |

---

## 📱 APK banane ka tarika — GitHub Actions (PC ki zaroorat nahi, FREE)

### Step 1: Apna GitHub repo banao
1. [github.com/new](https://github.com/new) pe jao
2. Repo name do (jaise `antigem-achiva`), **Private** select karo (safe hai)
3. **Create repository**

### Step 2: Project files upload karo
- Is zip ko unzip karo
- GitHub repo page pe **"uploading an existing file"** link pe click karo
- Ya PC pe git use karo:
  ```bash
  git init
  git add .
  git commit -m "AntiGem + Achiva merged"
  git branch -M master
  git remote add origin https://github.com/TUMHARA-USERNAME/antigem-achiva.git
  git push -u origin master
  ```

### Step 3: Signing key (keystore) — ✅ PEHLE SE BANA HUA HAI
Download folder me **`release.b64`** ready hai — Step 4 me usi ka use hoga.
(PC pe khud banana ho to: `keytool -genkeypair -v -keystore release.jks -alias antigem -keyalg RSA -keysize 2048 -validity 10000 -storepass 123456 -keypass 123456`)

> ⚠️ `release.jks` aur `release.b64` ko **repo me upload MAT karo** — sirf Step 4 me secret ke roop me use karna hai. Ye file sambhal ke rakhna (future updates isi key se sign hongi). Password: `123456` (build config isi ke saath set hai).

### Step 4: GitHub secret add karo
1. Apne repo me: **Settings → Secrets and variables → Actions**
2. **New repository secret**
3. Name: `RELEASE_KEYSTORE_BASE64`
4. Value: `release.b64` file ka poora content paste karo
5. Save

### Step 5: Build chalega
- `version.json` push hua to workflow **automatically** chalega
- Ya manually: repo me **Actions tab → "Build & Publish Release" → Run workflow**
- ~15-20 min me **Releases** section me APK milega: `antiGem-termux-v1.0.19-release.apk`

### Step 6: Phone me install
- APK download karo → install (Unknown sources allow karna padega pehli baar)
- Home screen pe **"AntiGem Achiva"** alag icon dikhega — original AntiGem ke saath

---

## 💻 Alternative: Android Studio (agar PC pe hai)
1. Project kholo (JDK 17+ needed)
2. Build variant: **termuxRelease** ya **standardRelease**
3. `Build → Build APK(s)`

---

## 🎯 Use kaise karna hai

- AntiGem Achiva kholo → chat screen ke **header me naya ✓ icon** (Browser/Terminal/IDE icons ke bagal me)
- Tap karo → **Achiva khul jayega** — poora app andar hi chalega
- **Back button**: pehle Achiva ke andar back chalega, phir chat me wapas
- **Login**: email/password ya Google — sab chalega (Firebase already configured hai)
- Screen toggle karne par Achiva ka **state aur login yaad rahega**

## 🔄 Future me Achiva web app update karo to?
Default mode **hosted URL** use karta hai (tumhara GitHub Pages) — web repo
update karte hi APK me bhi naya version chalne lagega. **APK rebuild ki zaroorat nahi.**

## 📴 Offline/bundled mode (optional)
`AchivaScreen.kt` me pehli line ke paas:
```kotlin
private const val USE_HOSTED_WEB = true   // ← false karo to bundled assets chalega
```
> Google sign-in bundled mode me chahiye to ek baar: Firebase Console →
> Authentication → Settings → Authorized domains me `appassets.androidplatform.net` add karo.

---

## ❓ Troubleshooting

| Problem | Fix |
|---|---|
| Workflow fail: "RELEASE_KEYSTORE_BASE64 is missing" | Step 4 secret sahi se add karo |
| APK install nahi ho raha | Purana download hua APK delete karke fresh download karo |
| Achiva blank/error dikhaye | Internet check karo (hosted mode) — ya "Dobara try karein" button dabao |
| Google sign-in issue | Email/password login use karo — 100% chalega |
| Original AntiGem gum ho gaya? | Nahi gaya — alag app hai, app drawer me dhundo |

---

*Merge details: Achiva web assets bundled + WebView screen, Firebase auth redirect-flow
support, Google sign-in web fallback, persistent state. Agent ↔ Achiva bridge (AI
integration) Phase-2 me add ho sakta hai.*
