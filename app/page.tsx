import Link from 'next/link';
import Image from 'next/image';
import { Activity, Zap, ArrowRight, ShieldCheck, Cpu } from 'lucide-react';
import { FeaturedGames } from '@/components/landing/FeaturedGames';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden selection:bg-[#00d4ff]/30">
      {/* Background Gradient Mesh */}
      <div className="absolute inset-0 gradient-mesh opacity-80 pointer-events-none" />

      {/* Navbar overlay */}
      <header className="absolute top-0 w-full p-6 flex justify-between items-center z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#00d4ff]/10 border border-[#00d4ff]/30 neon-glow-cyan flex items-center justify-center pulse-dot">
            <Activity className="w-5 h-5 text-[#00d4ff]" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white drop-shadow-md">NBA<span className="text-[#00d4ff]">Edge</span></span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link href="/signup" className="text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/10 neon-border-cyan rounded-full px-5 py-2 transition-all glass-card relative overflow-hidden group">
            <span className="relative z-10 text-white group-hover:neon-text-cyan transition-all">Get Started</span>
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto min-h-screen">
        {/* Hero Section */}
        <div className="text-center max-w-4xl mx-auto flex flex-col items-center gap-8 fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-card border-[#bf5af2]/30 mb-2 slide-up" style={{ animationDelay: '100ms' }}>
            <span className="flex h-2 w-2 rounded-full bg-[#39ff14] animate-pulse"></span>
            <span className="text-[11px] font-bold text-[#bf5af2] uppercase tracking-wider">Live Platform Now Available</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-tight text-white drop-shadow-lg slide-up" style={{ animationDelay: '200ms' }}>
            Dominate the Books with <br className="hidden md:block"/>
            <span className="neon-text-cyan text-[#00d4ff]">Data-Driven Precision</span>
          </h1>
          
          <p className="max-w-2xl text-lg md:text-xl text-muted-foreground slide-up" style={{ animationDelay: '300ms' }}>
            The ultimate data-driven NBA terminal. Actionable insights, predictive modeling, and live trending player props delivered at lightspeed.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 mt-6 slide-up" style={{ animationDelay: '400ms' }}>
            <Link
              href="/betting?onboard=1"
              className="group flex h-14 items-center justify-center gap-2 rounded-full bg-[#00d4ff] px-8 text-black font-bold transition-all hover:bg-[#00e5ff] neon-glow-cyan"
            >
              Start Winning Now
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/login"
              className="flex h-14 items-center justify-center rounded-full glass-card border border-white/10 px-8 text-white transition-all hover:bg-white/5 hover:border-white/20 neon-border-cyan group"
            >
              <span className="group-hover:neon-text-cyan transition-colors">Sign In</span>
            </Link>
          </div>
        </div>

        {/* Featured Games / Live Data */}
        <FeaturedGames />

        {/* Dashboard Preview / Screenshot */}
        <div className="mt-28 w-full max-w-6xl mx-auto slide-up group" style={{ animationDelay: '600ms' }}>
          <div className="relative rounded-2xl glass-card border border-white/10 shadow-2xl transition-all duration-500 hover:neon-glow-cyan hover:border-[#00d4ff]/40">
             <div className="relative rounded-xl overflow-visible bg-black/60 border border-white/5">
                <Image 
                  src="/dashboard.png" 
                  alt="NBA Platform Dashboard Preview" 
                  width={2400}
                  height={1350}
                  className="w-full h-auto opacity-90 group-hover:opacity-100 transition-all duration-500 group-hover:scale-[1.005] rounded-xl"
                  priority
                />
             </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl slide-up" style={{ animationDelay: '800ms' }}>
          <div className="glass-card p-8 rounded-2xl border border-white/5 card-hover relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-32 bg-[#bf5af2]/5 blur-[100px] group-hover:bg-[#bf5af2]/15 transition-all duration-500 rounded-full"></div>
            <Zap className="w-10 h-10 text-[#bf5af2] mb-6 neon-text-purple relative z-10" />
            <h3 className="text-xl font-bold text-white mb-3 relative z-10">Live Trend Analysis</h3>
            <p className="text-muted-foreground text-sm relative z-10">Monitor player streaks, momentum shifts, and statistical anomalies in real-time to catch edges before lines move.</p>
          </div>

          <div className="glass-card p-8 rounded-2xl border border-white/5 card-hover relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-32 bg-[#00d4ff]/5 blur-[100px] group-hover:bg-[#00d4ff]/15 transition-all duration-500 rounded-full"></div>
            <Cpu className="w-10 h-10 text-[#00d4ff] mb-6 neon-text-cyan relative z-10" />
            <h3 className="text-xl font-bold text-white mb-3 relative z-10">Advanced Statistical Models</h3>
            <p className="text-muted-foreground text-sm relative z-10">Proprietary algorithms process thousands of data points to highlight the highest EV player props on the board.</p>
          </div>

          <div className="glass-card p-8 rounded-2xl border border-white/5 card-hover relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-32 bg-[#39ff14]/5 blur-[100px] group-hover:bg-[#39ff14]/15 transition-all duration-500 rounded-full"></div>
            <ShieldCheck className="w-10 h-10 text-[#39ff14] mb-6 neon-text-lime relative z-10" />
            <h3 className="text-xl font-bold text-white mb-3 relative z-10">Injury & Rotation Intel</h3>
            <p className="text-muted-foreground text-sm relative z-10">Instant impact analysis when star players sit, automatically recalculating usage rates and secondary player projections.</p>
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 glass-card py-10 mt-20 bg-black/40">
        <div className="max-w-[1400px] mx-auto px-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 opacity-50">
            <Activity className="w-4 h-4" />
            <span className="font-bold tracking-tight">NBAEdge</span>
          </div>
          <p>© {new Date().getFullYear()} NBA Analytics Edge. For informational purposes only.</p>
        </div>
      </footer>
    </div>
  );
}
