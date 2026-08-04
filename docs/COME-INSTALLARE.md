# Apex Drive — come installarlo come app / APK

Questo `docs/` contiene il gioco pronto come **PWA** (app web installabile).
La grafica è quella attuale (arcade realistico), non NTE.

## 1) Attiva l'hosting (una volta sola)
Su GitHub, nel repository:
1. **Settings** → **Pages**
2. **Source**: *Deploy from a branch*
3. **Branch**: `claude/ps5-style-game-graphics-pehqy3` (o `main` dopo il merge) — cartella **`/docs`**
4. Salva. Dopo ~1 minuto avrai un link tipo:
   `https://umikasaiii.github.io/test-4/`

Questo link si apre nel **browser normale** (niente visualizzatore artifact), quindi si apre di sicuro.

## 2) Installa come app sul telefono
1. Apri quel link con **Chrome** (Android).
2. Menù ⋮ → **"Installa app"** oppure **"Aggiungi a schermata Home"**.
3. Comparirà l'**icona sul telefono**: si apre a **schermo intero** e funziona **offline**, come un'app.

## 3) (Opzionale) Genera un vero file .apk
Da quel link PWA:
1. Vai su **https://www.pwabuilder.com**
2. Incolla il tuo link (`https://umikasaiii.github.io/test-4/`) → **Start**
3. Sezione **Android** → **Generate Package** → scarichi un **.apk / .aab** installabile.

## Nota onesta
Impacchettare in APK **non cambia la grafica**: dentro c'è lo stesso gioco web.
La qualità tipo NTE (Unreal Engine 5) richiede un motore nativo + asset di uno
studio, e non è ottenibile da un singolo file web.
