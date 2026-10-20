// The founding team. Monthly cost (INR) is what each agent seat is billed internally.
export const AGENTS = [
  { id: "dia", name: "Dia", role: "Virtual Owner", dept: "dia", cost: 0, look: {} },
  { id: "asha", name: "Asha", role: "Hiring Agent", dept: "hr", cost: 18000, look: { skin: 0, style: "long", shirt: "#c2264b", bindi: 1, headset: 1 } },
  { id: "vikram", name: "Vikram", role: "Reporting Manager", dept: "hr", cost: 25000, look: { skin: 3, style: "short", shirt: "#5a3b6e", glasses: 1 } },
  { id: "rohan", name: "Rohan", role: "Policy & Onboarding", dept: "hr", cost: 15000, look: { skin: 2, style: "curly", shirt: "#8a5a2b" } },
  { id: "kabir", name: "Kabir", role: "Lead Hunter", dept: "sales", cost: 16000, look: { skin: 1, style: "short", shirt: "#d9930f", headset: 1 } },
  { id: "meera", name: "Meera", role: "Requirement Analyst", dept: "sales", cost: 20000, look: { skin: 5, style: "bun", shirt: "#2f8a4c", glasses: 1, bindi: 1 } },
  { id: "sameer", name: "Sameer", role: "Sales Manager", dept: "sales", cost: 26000, look: { skin: 4, style: "short", shirt: "#334a7a" } },
  { id: "neel", name: "Neel", role: "Solution Architect", dept: "eng", cost: 30000, look: { skin: 2, style: "short", shirt: "#2b6cb0", glasses: 1 } },
  { id: "tara", name: "Tara", role: "Full-stack Developer", dept: "eng", cost: 28000, look: { skin: 0, style: "long", shirt: "#3a7d8c" } },
  { id: "om", name: "Om", role: "DevOps · AWS", dept: "eng", cost: 27000, look: { skin: 3, style: "curly", shirt: "#4a4f5a", headset: 1 } },
  { id: "pooja", name: "Pooja", role: "Digital Marketing", dept: "mkt", cost: 17000, look: { skin: 5, style: "bun", shirt: "#7b4bb7", bindi: 1 } },
  { id: "isha", name: "Isha", role: "Content & Social", dept: "mkt", cost: 15000, look: { skin: 1, style: "long", shirt: "#b0478a" } }
];

export const COMPANY = () =>
  `You work at ${process.env.COMPANY_NAME || "Inveon Technologies"}, a software company in Pune, India that builds web apps, ` +
  `mobile apps, event-ticketing platforms, AI agents and cloud deployments for clients in India and worldwide. ` +
  `Internal figures are in INR; when talking to a foreign client, also state the price in their currency. ` +
  `Be practical, specific and honest. Never invent facts about the client; say what is unknown.`;
