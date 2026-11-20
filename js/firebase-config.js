// ─────────────────────────────────────────────────────────────
//  Configuration Firebase de My Timetable
//
//  1. Console Firebase → Paramètres du projet → Vos applications → Web (</>)
//  2. Copie l'objet "firebaseConfig" et colle les valeurs ci-dessous.
//
//  Tant que apiKey vaut "A_REMPLACER", l'appli tourne en MODE LOCAL :
//  les données sont stockées dans le navigateur (pratique pour tester).
//
//  Ces clés ne sont pas secrètes : la sécurité est assurée par les
//  règles Firestore (fichier firestore.rules).
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyAYhnp9OlCTgkxgkZy7HPyLABf31xypGzM",
  authDomain: "my-timetable-1b262.firebaseapp.com",
  projectId: "my-timetable-1b262",
  storageBucket: "my-timetable-1b262.firebasestorage.app",
  messagingSenderId: "124648262930",
  appId: "1:124648262930:web:d8606b9a479c4ba33ff7cb"
};

// Clé de site reCAPTCHA (publique) utilisée par Firebase App Check,
// obligatoire pour la lecture IA des PDF (Firebase AI Logic).
export const appCheckSiteKey = "6LcomikuAAAAAP0DB3ioVfehmH44Gx-840yHoWZB";
