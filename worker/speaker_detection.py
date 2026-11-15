#!/usr/bin/env python3
"""Estimate active speaker from isolated microphone tracks using short-window RMS.
Usage: python speaker_detection.py --tracks mic1.wav mic2.wav --names Host Guest --out speaker_timeline.json
Requires: pip install numpy soundfile
This is a mic-track heuristic, not voice diarization. Use one isolated mic per speaker.
"""
import argparse,json
import numpy as np
import soundfile as sf

def main():
 p=argparse.ArgumentParser();p.add_argument('--tracks',nargs='+',required=True);p.add_argument('--names',nargs='+');p.add_argument('--out',default='speaker_timeline.json');p.add_argument('--window',type=float,default=1.0);a=p.parse_args()
 names=a.names or [f'Speaker {i+1}' for i in range(len(a.tracks))]
 if len(names)!=len(a.tracks): raise SystemExit('--names count must match --tracks')
 loaded=[];sr0=None;duration=0
 for f in a.tracks:
  x,sr=sf.read(f);x=np.mean(x,axis=1) if x.ndim>1 else x
  if sr0 is None:sr0=sr
  if sr!=sr0:raise SystemExit('All tracks must have the same sample rate')
  loaded.append(x);duration=max(duration,len(x)/sr)
 n=int(a.window*sr0);out=[]
 for start in np.arange(0,duration,a.window):
  energies=[]
  for x in loaded:
   seg=x[int(start*sr0):int(min(start+a.window,duration)*sr0)]
   energies.append(float(np.sqrt(np.mean(seg**2))) if len(seg) else 0)
  winner=int(np.argmax(energies));out.append({'start':round(float(start),3),'end':round(float(min(start+a.window,duration)),3),'speaker':names[winner] if max(energies)>1e-5 else 'UNKNOWN','rms':energies})
 with open(a.out,'w') as f:json.dump(out,f,indent=2)
 print(f'Wrote {len(out)} speaker windows to {a.out}')
if __name__=='__main__':main()
