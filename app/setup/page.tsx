"use client";

import { useRouter } from "next/navigation";
import SetupScreen from "@/components/SetupScreen";

// /setup — Business Setup wizard ka apna route. Pehli dafa ye staff home
// aur /online par inline bhi render hota hai (SetupGate); Owner Settings
// → Business Setup → "Tabdeel karein" yahin lata hai (change mode wizard
// khud pehchan leta hai ke setup pehle ho chuka hai).
export default function SetupPage() {
  const router = useRouter();
  return <SetupScreen onDone={() => router.push("/")} />;
}
