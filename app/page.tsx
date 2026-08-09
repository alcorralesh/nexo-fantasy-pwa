import { FantasyApp } from "./FantasyApp";
import { fantasyRepository } from "./data";

export default async function Home() {
  const initialData = await fantasyRepository.getBootstrap();

  return <FantasyApp initialData={initialData} />;
}
