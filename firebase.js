// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCfQVHr6cJlbM5e-GHTu8J3PJ6lV6QXZ6g",
  authDomain: "ascuita.firebaseapp.com",
  projectId: "ascuita",
  storageBucket: "ascuita.firebasestorage.app",
  messagingSenderId: "94806719884",
  appId: "1:94806719884:web:16a517ebad7e3ecaf6aaa9",
  measurementId: "G-6ERJVSHMSP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);