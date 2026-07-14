# Apex Drive 3D — versione "motore vero"

Questa **non** è la versione artifact (file HTML unico). È un **progetto di gioco vero**:
motore web con asset reali, pensato per avvicinarsi alla resa di un gioco console.

## Cosa usa (roba vera, non procedurale)
- **Three.js** (rendering PBR, ombre, tone mapping ACES)
- **Rapier** (`@dimforge/rapier3d`) — motore di **fisica veicolo reale**: raycast
  vehicle con sospensioni, grip, freni, handbrake
- **Auto vera in GLTF**: modello Ferrari (Draco-compressed) con vernice
  clearcoat, vetri, cerchi
- **Illuminazione HDRI reale** (image-based lighting) → riflessi e luce da
  ambiente fotografico (golden hour)
- **Texture PBR** per l'erba

Tutti gli asset sono in `public/assets/` (modello, HDRI, texture, decoder Draco),
quindi il gioco funziona **offline**, senza CDN esterni.

## Come si avvia

```bash
cd apex-drive-3d
npm install
npm run dev      # apri l'URL che stampa (es. http://localhost:5173)
```

Per una build statica da pubblicare ovunque (Netlify, Vercel, GitHub Pages, ecc.):

```bash
npm run build    # genera la cartella dist/
npm run preview  # anteprima locale della build
```

## Comandi
- **Tastiera:** ↑ gas · ↓ freno/retro · ← → sterzo · **SPAZIO** handbrake · **R** reset
- **Touch:** pulsanti GAS / FRENO / ◄ ► su schermo

## Note oneste sulla qualità
È un salto netto rispetto alla versione single-file: auto, luce e fisica sono
"vere". Non è (e non può essere in questa forma) identico a un titolo AAA come
CTR: quello richiede asset disegnati a mano, personaggi e tracciati originali,
lightmap precalcolate e un team di artisti. Qui il livello dipende soprattutto
dagli asset — si può alzare ancora aggiungendo modelli/ambienti/texture di
qualità superiore.

## Prossimi passi possibili
- Più modelli auto (GLTF) selezionabili
- Tracciato/città modellati come mesh vere invece che open field
- Materiali PBR completi (normal/roughness/AO) per strada e terreno
- Sistema di gioco (giri a tempo, traffico, checkpoint)
