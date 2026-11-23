# 🦊 Pogodi životinju — online igra za dvoje

Gotova mala web aplikacija na hrvatskom. Dvoje ljudi igra zajedno u stvarnom vremenu, svaki sa svojeg mobitela ili računala. Bez korisničkih računa i registracije.

## Što igra može?

- **Privatna soba** za 2 igrača i pozivni link/kod od 6 znakova.
- **134 poznate životinje** u lokalnoj JSON bazi (`data/animals.json`): domaće, divlje, ptice, ribe, gmazovi, beskralježnjaci i druge.
- Odabir tajne životinje uz **pretragu** i prijedloge.
- **Privatne činjenice** o vlastitoj životinji (stanište, prehrana i dvije zanimljivosti), koje su skrivene od partnera tijekom runde.
- **Dopisivanje uživo**, brza pitanja i pogađanje protivnikove životinje.
- Server provjerava pogodak; po pobjedi otkriva životinje, bilježi rezultat i dopušta novu rundu.
- Automatsko ponovno spajanje nakon gubitka mreže, dok je soba još aktivna.
- Prilagođeno mobitelima i računalima.

## Pokretanje na računalu

Preduvjet: [Node.js](https://nodejs.org/) verzija 20 ili novija.

```bash
npm install
npm start
```

Otvori `http://localhost:3000` u pregledniku. Za automatsko ponovno pokretanje tijekom razvoja možeš koristiti `npm run dev`. Za testove pokreni `npm test`.

**Važno:** Ako otvoriš samo `public/index.html` bez servera, online igra neće raditi. Potrebno je pokrenuti aplikaciju na Node.js serveru.

## Kako besplatno postaviti online (Render)

1. Otvori [GitHub](https://github.com/) i napravi novi repository (npr. `pogodi-zivotinju`). Uploadaj **sadržaj ove mape**, tako da `server.js` i `package.json` budu u korijenu repozitorija.
2. Prijavi se na [Render](https://dashboard.render.com/) i klikni **New → Web Service**.
3. Spoji GitHub repository. Odaberi **Node**, i besplatni plan ako je ponuđen.
4. Build Command: `npm install` (ili `npm ci` ako imaš `package-lock.json`). Start Command: `npm start`. Možeš upotrijebiti i priloženi `render.yaml` za Blueprint.
5. Kad se aplikacija objavi, otvori svoju javnu adresu u obliku `https://ime-aplikacije.onrender.com`.
6. Klikni **Napravi sobu**, a zatim **Pošalji link**. Drugi igrač otvara isti link na svojem uređaju.

Render podržava WebSocket veze koje ova aplikacija koristi preko Socket.IO. Na besplatnom planu servis se može uspavati nakon neaktivnosti pa prvi pristup može biti sporiji.

## Pravila igre

1. Prvi igrač kreira sobu i pošalje partneru link.
2. Svaki igrač upiše svoje ime, odabere svoju tajnu životinju i potvrdi odabir.
3. Oba igrača vide **samo svoje** činjenice. Npr. mogu pitati: „Je li sisavac?” ili „Živi li u vodi?”
4. U chatu odgovaraju na pitanja. Ako misle da znaju što je drugi odabrao, pronađu životinju pod **Znaš odgovor?** i kliknu **Pogodi**.
5. Točan pogodak donosi 1 bod. Pogrešan pogodak se vidi u chatu, ali igra se nastavlja.
6. Pobjednik završava rundu i svatko može pokrenuti novi revanš.

## Struktura datoteka

```text
pogodi-zivotinju/
├── server.js             # Node + Express + Socket.IO, sobe i pravila
├── package.json          # Biblioteke i npm naredbe
├── render.yaml           # Opcionalna Render konfiguracija
├── data/animals.json     # Baza sa 134 životinje i činjenicama
├── public/
│   ├── index.html        # Sučelje
│   ├── styles.css        # Izgled i mobilni prikaz
│   └── app.js            # Odabir, chat i prikaz igre
└── tests/server.test.js  # Integracijske provjere
```

## Kako dodati novu životinju?

U `data/animals.json` dodaj novi objekt po uzorku:

```json
{
  "id": "novi-id",
  "name": "Naziv životinje",
  "emoji": "🐾",
  "group": "Sisavac",
  "habitat": "Šume",
  "diet": "Svejed",
  "facts": ["Prva zanimljivost.", "Druga zanimljivost."]
}
```

Nakon promjene ponovo pokreni server.

## Napomene

- Podaci o životinjama su **lokalno uređena, osnovna baza**, nisu automatski preuzete sve zoološke vrste niti se tvrdi da je popis potpun.
- Sobe, rezultat i poruke **privremeno se čuvaju u memoriji servera**, ne u trajnoj bazi. Nakon ponovnog pokretanja/deploya se gube. Prazne sobe se brišu nakon 30 minuta bez povezanih igrača.
- Nema korisničkih računa, korisnici ne moraju unositi osobne podatke. Link i kod sobe podijeli samo s osobom s kojom želiš igrati.
- Za više instanci servera trebalo bi dodati Redis Socket.IO adapter i trajnu pohranu. Ovaj projekt je namjerno jednostavan i predviđen za jedan server.
