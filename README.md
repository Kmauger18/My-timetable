# 📅 My Timetable

Affichage des emplois du temps semaine par semaine, avec un espace **Gestion** protégé par connexion pour les modifier. Les données sont sauvegardées en ligne dans **Firebase** (Authentication + Cloud Firestore).

## Fonctionnalités

**Consultation (sans compte)**
- Grille de la semaine (lundi → vendredi, samedi ou dimanche au choix), avec ligne « maintenant » et jour courant mis en avant
- Vue liste par jour automatique sur téléphone
- Navigation ← / → (boutons ou flèches du clavier), bouton « Aujourd'hui », choix d'une date
- Détail d'une séance au clic (salle, bâtiment, prof avec lien e-mail, note)
- Total d'heures de la semaine et répartition par cours
- Export de la semaine vers un agenda (`.ics` : Google Agenda, Outlook, téléphone…)
- Impression A4 paysage
- Lien direct vers une semaine : `…/#2026-11-16`
- Installable comme une appli (PWA), consultable hors-ligne

**Gestion (après connexion)**
- Clic sur un créneau vide de la grille → nouvelle séance à cette heure
- Séance : cours, jour, type (Cours, CM, TD, TP, Projet, Examen, Autre), début/fin, prof, salle, note
- Création d'un cours, d'un prof ou d'une salle directement depuis la séance (bouton **+**)
- **Bibliothèque** Cours · Profs · Salles réutilisables (couleur et abréviation par cours, recherche, modification, suppression)
- Alerte en cas de chevauchement (même salle ou même prof)
- Dupliquer une séance, ou la copier sur les N semaines suivantes
- Dupliquer toute une semaine (semaine suivante, N semaines, ou une date précise ; remplacer ou ajouter)
- Type de semaine : école, entreprise (alternance), examens, vacances + note de semaine
- **Import depuis un PDF ou une photo** (même manuscrit) : chaque page est lue par l'IA Gemini (Firebase AI Logic), puis un écran de vérification affiche l'image à côté des séances détectées pour corriger avant d'importer. Les cours, profs et salles inconnus sont créés automatiquement. Sans IA (mode local), saisie manuelle à côté de l'image.
- Paramètres : titre, heures de début/fin de journée, jours affichés, durée par défaut

## Mise en route

### 1. Tester tout de suite (mode local)
Tant que `js/firebase-config.js` n'est pas rempli, l'appli fonctionne en **mode local** : les données (avec un exemple) sont stockées dans le navigateur et le bouton Gestion ne demande pas de mot de passe.

```bash
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```

### 2. Brancher Firebase
1. [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet** (ex. « My Timetable »), Google Analytics facultatif.
2. **Authentication** → Commencer → **E-mail/Mot de passe** → Activer.
3. **Authentication → Utilisateurs → Ajouter un utilisateur** : crée ton compte de gestion (e-mail + mot de passe).
4. **Firestore Database** → Créer une base de données → région `eur3 (europe-west)` → mode production.
5. **Paramètres du projet → Vos applications → Web (`</>`)** → enregistre l'appli, copie l'objet `firebaseConfig` dans `js/firebase-config.js`.
6. **Firestore → Règles** : colle le contenu de `firestore.rules` en remplaçant `TON.EMAIL@exemple.fr` par l'e-mail du compte créé à l'étape 3, puis **Publier**.
7. **Authentication → Paramètres → Domaines autorisés** : ajoute `kmauger18.github.io`.

8. Pour l'import PDF/photo : **AI Logic → Commencer → Gemini Developer API** (offre sans frais) → Activer l'API. Firebase impose App Check sur AI Logic : l'appli Web est enregistrée dans **App Check** avec le fournisseur *Fraud Defense (reCAPTCHA Enterprise)* et la clé de site `appCheckSiteKey` de `js/firebase-config.js` (domaines `kmauger18.github.io` et `localhost`).

Tout reste dans le forfait gratuit **Spark**.

### 3. Mettre en ligne (GitHub Pages)
Dépôt → **Settings → Pages** → Source : *Deploy from a branch* → `main` / `(root)`.
Adresse : `https://kmauger18.github.io/My-timetable/`

## Structure des données (Firestore)

| Collection | Document | Contenu |
|---|---|---|
| `courses` | auto | `name`, `code`, `color` |
| `teachers` | auto | `name`, `email`, `note` |
| `rooms` | auto | `name`, `building`, `note` |
| `weeks` | date du lundi `AAAA-MM-JJ` | `type`, `note`, `sessions[]` (`id`, `day` 0=lundi, `start`, `end`, `courseId`, `teacherId`, `roomId`, `type`, `note`) |
| `settings` | `general` | `title`, `startHour`, `endHour`, `days`, `defaultDuration` |

Lecture publique, écriture réservée au(x) e-mail(s) administrateur(s) listés dans `firestore.rules`.

## Fichiers

```
index.html            page unique
css/style.css         styles (clair/sombre automatique, mobile, impression)
js/app.js             interface et logique
js/store.js           accès aux données (Firebase ou local)
js/firebase-config.js configuration Firebase à remplir
firestore.rules       règles de sécurité à publier dans Firebase
sw.js, manifest.webmanifest   PWA / hors-ligne
assets/logo.svg       logo
```
