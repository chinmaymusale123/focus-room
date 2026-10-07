import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Circle, CloudRain, Coffee, Headphones, Leaf, Pause, Play, Plus, RotateCcw, Trash2, Volume2 } from 'lucide-react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type Task = { id: string; text: string; completed: boolean; createdAt: number };
type TimerPreferences = { workMinutes: number; breakMinutes: number };
type SoundKind = 'rain' | 'lofi' | 'cafe';
type AudioGraph = { context: AudioContext; master: GainNode; nodes: AudioNode[] };

const queryClient = new QueryClient();
const TASKS_KEY = 'focus-room-tasks';
const TIMER_KEY = 'focus-room-timer-preferences';
const defaultPreferences: TimerPreferences = { workMinutes: 25, breakMinutes: 5 };

function readTasks(): Task[] {
  try {
    const saved = localStorage.getItem(TASKS_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((task) => task && typeof task.id === 'string' && typeof task.text === 'string') : [];
  } catch { return []; }
}

function readPreferences(): TimerPreferences {
  try {
    const saved = localStorage.getItem(TIMER_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    const workMinutes = Number(parsed.workMinutes);
    const breakMinutes = Number(parsed.breakMinutes);
    return {
      workMinutes: Number.isFinite(workMinutes) ? Math.min(90, Math.max(1, workMinutes)) : defaultPreferences.workMinutes,
      breakMinutes: Number.isFinite(breakMinutes) ? Math.min(30, Math.max(1, breakMinutes)) : defaultPreferences.breakMinutes,
    };
  } catch { return defaultPreferences; }
}

function noiseBuffer(context: AudioContext, seconds = 3) {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function createSound(context: AudioContext, kind: SoundKind, master: GainNode): AudioNode[] {
  const nodes: AudioNode[] = [];
  if (kind === 'lofi') {
    const tones = [{ frequency: 174.61, gain: 0.13 }, { frequency: 220, gain: 0.09 }, { frequency: 261.63, gain: 0.06 }];
    tones.forEach(({ frequency, gain }) => {
      const oscillator = context.createOscillator();
      const level = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      level.gain.value = gain;
      oscillator.connect(level).connect(master);
      oscillator.start();
      nodes.push(oscillator, level);
    });
    const slowPulse = context.createOscillator();
    const pulseGain = context.createGain();
    slowPulse.frequency.value = 0.12;
    pulseGain.gain.value = 0.025;
    slowPulse.connect(pulseGain).connect(master.gain);
    slowPulse.start();
    nodes.push(slowPulse, pulseGain);
  } else {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const level = context.createGain();
    source.buffer = noiseBuffer(context);
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'rain' ? 720 : 420;
    filter.Q.value = kind === 'rain' ? 0.7 : 0.4;
    level.gain.value = kind === 'rain' ? 0.56 : 0.27;
    source.connect(filter).connect(level).connect(master);
    source.start();
    nodes.push(source, filter, level);
    if (kind === 'cafe') {
      const hum = context.createOscillator();
      const humGain = context.createGain();
      hum.type = 'sine';
      hum.frequency.value = 83;
      humGain.gain.value = 0.018;
      hum.connect(humGain).connect(master);
      hum.start();
      nodes.push(hum, humGain);
    }
  }
  return nodes;
}

function Home() {
  const [tasks, setTasks] = useState<Task[]>(readTasks);
  const [draft, setDraft] = useState('');
  const [preferences, setPreferences] = useState<TimerPreferences>(readPreferences);
  const [isBreak, setIsBreak] = useState(false);
  const [remaining, setRemaining] = useState(() => readPreferences().workMinutes * 60);
  const [running, setRunning] = useState(false);
  const [playingSound, setPlayingSound] = useState<SoundKind | null>(null);
  const [volume, setVolume] = useState(34);
  const audioRef = useRef<AudioGraph | null>(null);
  const endTimeRef = useRef<number | null>(null);

  useEffect(() => { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem(TIMER_KEY, JSON.stringify(preferences)); }, [preferences]);

  const tick = useCallback(() => {
    const endsAt = endTimeRef.current;
    if (endsAt === null) return;
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    setRemaining(seconds);
    if (seconds === 0) {
      setRunning(false);
      endTimeRef.current = null;
      setIsBreak((wasBreak) => {
        const nextIsBreak = !wasBreak;
        setRemaining((nextIsBreak ? preferences.breakMinutes : preferences.workMinutes) * 60);
        return nextIsBreak;
      });
    }
  }, [preferences.breakMinutes, preferences.workMinutes]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [running, tick]);

  useEffect(() => {
    const graph = audioRef.current;
    if (graph) graph.master.gain.setTargetAtTime(volume / 100, graph.context.currentTime, 0.04);
  }, [volume, playingSound]);

  useEffect(() => () => {
    const graph = audioRef.current;
    if (graph) {
      graph.nodes.forEach((node) => { try { if ('stop' in node && typeof node.stop === 'function') node.stop(); } catch { /* already stopped */ } });
      void graph.context.close();
    }
  }, []);

  const toggleTimer = () => {
    if (running) {
      setRunning(false);
      endTimeRef.current = null;
      return;
    }
    endTimeRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  };

  const resetTimer = () => {
    endTimeRef.current = null;
    setRunning(false);
    setRemaining((isBreak ? preferences.breakMinutes : preferences.workMinutes) * 60);
  };

  const changePreference = (kind: keyof TimerPreferences, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(kind === 'workMinutes' ? 90 : 30, Math.max(1, Math.round(parsed)));
    setPreferences((current) => ({ ...current, [kind]: next }));
    if (!running) setRemaining((isBreak ? (kind === 'breakMinutes' ? next : preferences.breakMinutes) : (kind === 'workMinutes' ? next : preferences.workMinutes)) * 60);
  };

  const stopSound = () => {
    const graph = audioRef.current;
    if (graph) {
      graph.nodes.forEach((node) => { try { if ('stop' in node && typeof node.stop === 'function') node.stop(); } catch { /* already stopped */ } });
      void graph.context.close();
      audioRef.current = null;
    }
    setPlayingSound(null);
  };

  const toggleSound = (kind: SoundKind) => {
    if (playingSound === kind) {
      stopSound();
      return;
    }
    stopSound();
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const master = context.createGain();
    master.gain.value = volume / 100;
    master.connect(context.destination);
    const nodes = createSound(context, kind, master);
    audioRef.current = { context, master, nodes };
    setPlayingSound(kind);
    if (context.state === 'suspended') void context.resume();
  };

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setTasks((current) => [{ id: crypto.randomUUID(), text, completed: false, createdAt: Date.now() }, ...current]);
    setDraft('');
  };

  const displayTime = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const completedCount = tasks.filter((task) => task.completed).length;

  return (
    <main className="app-shell">
      <div className="page">
        <header className="topbar">
          <div className="brand" data-testid="brand-focus-room">
            <span className="brand-mark"><Leaf size={20} strokeWidth={1.8} /></span>
            <span className="brand-name">focus room</span>
          </div>
          <div className="top-note"><span aria-hidden="true" /> A little space to think</div>
        </header>

        <section className="intro" aria-labelledby="welcome-title">
          <div>
            <p className="eyebrow">YOUR QUIET CORNER</p>
            <h1 id="welcome-title">Settle in.<br />Find your flow.</h1>
          </div>
          <p className="intro-copy">A softer place to focus on what matters, one small stretch at a time.</p>
        </section>

        <section className="dashboard" aria-label="Focus dashboard">
          <section className="panel timer-panel" aria-label="Focus timer">
            <div className="timer-top">
              <div className="section-label"><Circle size={14} strokeWidth={1.8} /> FOCUS TIMER</div>
              <div className="mode-tag" data-testid="status-timer-mode"><i aria-hidden="true" />{isBreak ? 'Taking a pause' : 'Deep focus'}</div>
            </div>
            <div className="timer-face" aria-live="off">
              <span className="timer-time" data-testid="text-timer-countdown">{displayTime}</span>
              <span className="timer-caption">{isBreak ? 'Rest, then return' : 'One thing at a time'}</span>
            </div>
            <div className="timer-controls">
              <button className="primary-button" type="button" onClick={toggleTimer} data-testid="button-timer-toggle" aria-label={running ? 'Pause timer' : 'Start timer'}>
                {running ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                {running ? 'Pause' : 'Begin focus'}
              </button>
              <button className="icon-button" type="button" onClick={resetTimer} aria-label="Reset timer" data-testid="button-timer-reset"><RotateCcw size={17} /></button>
            </div>
            <div className="duration-row" aria-label="Timer durations">
              <div className="duration-control">
                <label htmlFor="work-minutes">Focus</label>
                <input id="work-minutes" aria-label="Focus duration in minutes" type="number" min="1" max="90" value={preferences.workMinutes} onChange={(event) => changePreference('workMinutes', event.target.value)} data-testid="input-work-duration" />
                <span>min</span>
              </div>
              <div className="duration-control">
                <label htmlFor="break-minutes">Rest</label>
                <input id="break-minutes" aria-label="Break duration in minutes" type="number" min="1" max="30" value={preferences.breakMinutes} onChange={(event) => changePreference('breakMinutes', event.target.value)} data-testid="input-break-duration" />
                <span>min</span>
              </div>
            </div>
          </section>

          <div className="right-column">
            <section className="panel tasks-panel" aria-labelledby="tasks-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KEEP IT LIGHT</p>
                  <h2 className="panel-title" id="tasks-title">Today, gently</h2>
                </div>
                <span className="task-count" data-testid="text-task-count">{completedCount}/{tasks.length} done</span>
              </div>
              <form className="task-form" onSubmit={addTask}>
                <label className="sr-only" htmlFor="new-task">Add a priority</label>
                <input id="new-task" className="task-input" type="text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What would feel good to finish?" maxLength={120} data-testid="input-new-task" />
                <button className="add-button" type="submit" aria-label="Add priority" data-testid="button-add-task"><Plus size={19} /></button>
              </form>
              {tasks.length > 0 ? (
                <div className="task-list" role="list" aria-label="Today's priorities">
                  {tasks.map((task) => (
                    <div className="task-row" role="listitem" key={task.id} data-testid={`task-row-${task.id}`}>
                      <button className={`check-button${task.completed ? ' is-complete' : ''}`} type="button" aria-label={`${task.completed ? 'Mark incomplete' : 'Complete'}: ${task.text}`} aria-pressed={task.completed} onClick={() => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: !item.completed } : item))} data-testid={`button-toggle-task-${task.id}`}>
                        {task.completed && <Check size={13} strokeWidth={2.5} />}
                      </button>
                      <span className={`task-text${task.completed ? ' is-complete' : ''}`} data-testid={`text-task-${task.id}`}>{task.text}</span>
                      <button className="delete-button" type="button" aria-label={`Delete ${task.text}`} onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))} data-testid={`button-delete-task-${task.id}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-tasks" data-testid="empty-tasks">
                  <span className="empty-mark"><Check size={16} /></span>
                  <p>Your list is open.<br />Add one thing to begin.</p>
                </div>
              )}
            </section>

            <section className="panel sound-panel" aria-labelledby="sound-title">
              <div className="panel-heading">
                <div className="sound-title-wrap">
                  <span className="sound-mark"><Headphones size={17} /></span>
                  <h2 className="panel-title" id="sound-title">Room tone</h2>
                </div>
                <span className="task-count">LISTEN IN</span>
              </div>
              <div className="sound-list">
                <button className={`sound-button${playingSound === 'rain' ? ' is-playing' : ''}`} type="button" aria-pressed={playingSound === 'rain'} onClick={() => toggleSound('rain')} data-testid="button-sound-rain">
                  <span className="sound-label"><CloudRain size={15} /> Rain</span><span className="sound-state">{playingSound === 'rain' ? 'Playing' : 'Play'}</span>
                </button>
                <button className={`sound-button${playingSound === 'lofi' ? ' is-playing' : ''}`} type="button" aria-pressed={playingSound === 'lofi'} onClick={() => toggleSound('lofi')} data-testid="button-sound-lofi">
                  <span className="sound-label"><Circle size={14} /> Lo-Fi</span><span className="sound-state">{playingSound === 'lofi' ? 'Playing' : 'Play'}</span>
                </button>
                <button className={`sound-button${playingSound === 'cafe' ? ' is-playing' : ''}`} type="button" aria-pressed={playingSound === 'cafe'} onClick={() => toggleSound('cafe')} data-testid="button-sound-cafe">
                  <span className="sound-label"><Coffee size={15} /> Cafe</span><span className="sound-state">{playingSound === 'cafe' ? 'Playing' : 'Play'}</span>
                </button>
              </div>
              <label className="volume-row" htmlFor="sound-volume">
                <Volume2 size={16} />
                <span className="sr-only">Ambient sound volume</span>
                <input id="sound-volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Ambient sound volume" data-testid="input-sound-volume" />
                <span className="volume-value" data-testid="text-sound-volume">{volume}%</span>
              </label>
            </section>
          </div>
        </section>
        <p className="footer-note"><Leaf size={13} /> Take the time you need. The rest can wait.</p>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
