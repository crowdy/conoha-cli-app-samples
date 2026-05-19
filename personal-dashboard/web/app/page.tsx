import { Brand } from "@/components/Brand";
import { Clock } from "@/components/Clock";
import { Countdowns } from "@/components/Countdowns";
import { DateLine } from "@/components/DateLine";
import { ScheduleSection } from "@/components/ScheduleSection";
import { Shortcuts } from "@/components/Shortcuts";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Weather } from "@/components/Weather";

export default function HomePage() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <ThemeToggle />
      <header className="text-center">
        <Brand />
      </header>

      <div className="flex flex-col items-center space-y-1">
        <Clock />
        <DateLine />
        <Weather />
      </div>

      <Countdowns />
      <ScheduleSection day="today" title="今日の予定" />
      <ScheduleSection day="tomorrow" title="明日の予定" />
      <Shortcuts />
    </main>
  );
}
