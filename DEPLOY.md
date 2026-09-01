# Jenna AI Assistant — Free Hosting Guide (Hindi)

Is guide se aap Jenna app ko **render.com** ke free plan par host kar sakte ho.
Isse aapko ek **permanent public link** milega — phone, laptop, kahin se bhi khulega.

---

## Step 0: GitHub par PR merge karo (1 click)

1. GitHub par apna repo kholo: `radhesolanki319-pixel/Jenna_android-web`
2. **Pull Requests** tab me jao — wahan "bring-your-own-key activation" wala PR milega
3. Green **"Merge pull request"** button dabao → **"Confirm merge"**

(Isse latest code `main` branch me aa jayega jisme API key wali feature hai.)

---

## Step 1: Render par account banao (2 minute)

1. Browser me kholo: **https://render.com**
2. **Get Started** par click karo
3. **"Sign up with GitHub"** choose karo → GitHub ka username/password daalo → Authorize

## Step 2: App deploy karo (3 minute)

1. Render dashboard me **"New +"** (upar right) → **"Web Service"** select karo
2. Repository list me **`Jenna_android-web`** dikhengi → uspar **"Connect"** dabao
   - (Agar list me na dikhe toh "Configure account" karke repo ko access do)
3. Settings:
   - **Name:** `jenna-ai` (jo bhi pasand karo)
   - **Region:** Singapore / Frankfurt (India ke sabse paas)
   - **Branch:** `main`
   - **Instance Type:** **Free** select karo
4. **"Deploy Web Service"** dabao
5. 3-5 minute wait karo — status **"Live"** dikhne tak

## Step 3: App kholo 🎉

- Dashboard me upar aapko link milega, jaise: `https://jenna-ai.onrender.com`
- Us link par click karo → **Jenna app khul gayi!**
- Amber banner par click karke apni Gemini API key (`AIza...` se shuru) paste karo → **Connect**
- Key yahan se banao (free): https://aistudio.google.com/apikey

---

## Optional: Server par bhi API key daalna ho toh

Render dashboard → apni service → **"Environment"** tab → **"Add Environment Variable"**:
- **Key:** `GEMINI_API_KEY`
- **Value:** apni `AIza...` key

Ye optional hai — app apni key banner se bhi leti hai. Server key daalne se
Gemini Neural Voice (TTS) bhi server se chalega.

## Notes

- Free plan me 15 minute idle ke baad server sleep hota hai — link kholne par
  ~30 second lag kar khul jata hai. Bas.
- Poora code aapke GitHub par hai: `radhesolanki319-pixel/Jenna_android-web`
