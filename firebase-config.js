/* ===================== Firebase 연결 설정 =====================
   1. https://console.firebase.google.com 에서 새 프로젝트를 만드세요 (무료).
   2. 왼쪽 메뉴에서 "Firestore Database" > "데이터베이스 만들기"를 눌러 생성하세요.
   3. 프로젝트 설정(⚙️) > 일반 탭 > "내 앱" > 웹 앱(</>) 추가를 누르면
      아래와 똑같이 생긴 firebaseConfig 코드가 나와요. 그 값을 통째로
      복사해서 아래 객체에 붙여넣으면 끝이에요.
   자세한 단계별 설명은 SETUP.md 파일을 확인하세요.
================================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCR1S-wRoTAvFJzHtiAvUnXJ6suUqCbJCg",
  authDomain: "seedbanktastygarden.firebaseapp.com",
  projectId: "seedbanktastygarden",
  storageBucket: "seedbanktastygarden.firebasestorage.app",
  messagingSenderId: "326020077592",
  appId: "1:326020077592:web:4fccd3c4add04415e00b6d"
};
