"""
BTC Market Regime Detection using Hidden Markov Model (HMM)
-----------------------------------------------------------
Downloads 1h BTC-USDT data (last 740 days), engineers features,
fits a 7-state Gaussian HMM, and visualises detected regimes.
"""

import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from hmmlearn.hmm import GaussianHMM
from datetime import datetime, timedelta

# ── 1) Download 1h BTC-USD for the last 730 days ───────────────────────────
# yfinance caps 1h data at 730 days, so we download in 3 safe chunks (~245 days each)
end_date = datetime.now()
start_date = end_date - timedelta(days=729)       # stay inside the 730-day limit

chunk_size = timedelta(days=245)
boundaries = []
t = start_date
while t < end_date:
    t_end = min(t + chunk_size, end_date)
    boundaries.append((t, t_end))
    t = t_end

print(f"⏳ Downloading BTC-USD 1h data in {len(boundaries)} chunks …")
frames = []
for i, (s, e) in enumerate(boundaries, 1):
    print(f"   chunk {i}/{len(boundaries)}: {s.strftime('%Y-%m-%d')} → {e.strftime('%Y-%m-%d')}")
    df = yf.download("BTC-USD", start=s, end=e, interval="1h")
    if not df.empty:
        frames.append(df)

data = pd.concat(frames).sort_index()
data = data[~data.index.duplicated(keep="first")]

# Flatten multi-level columns if present (yfinance sometimes returns them)
if isinstance(data.columns, pd.MultiIndex):
    data.columns = data.columns.get_level_values(0)

print(f"✅ Downloaded {len(data)} hourly bars  "
      f"({data.index[0].strftime('%Y-%m-%d')} → {data.index[-1].strftime('%Y-%m-%d')})\n")

# ── 2) Feature Engineering ──────────────────────────────────────────────────
data["return"]     = data["Close"].pct_change()
data["range"]      = (data["High"] - data["Low"]) / data["Close"]
data["vol_change"] = data["Volume"].pct_change()

# Drop NaN / inf rows produced by pct_change and division
data.replace([np.inf, -np.inf], np.nan, inplace=True)
data.dropna(subset=["return", "range", "vol_change"], inplace=True)

print(f"📊 Features ready — {len(data)} usable rows\n")

# ── 3) Train Gaussian HMM ──────────────────────────────────────────────────
features = ["return", "range", "vol_change"]
X = data[features].values

model = GaussianHMM(
    n_components=7,
    covariance_type="full",
    n_iter=1000,
    random_state=42,
)

print("🔧 Training 7-state Gaussian HMM …")
model.fit(X)
print(f"✅ Converged after {model.monitor_.iter} iterations\n")

# ── 4) Predict hidden states ───────────────────────────────────────────────
data["state"] = model.predict(X)

# ── 5) Analyse — summary table per regime ───────────────────────────────────
summary = (
    data.groupby("state")["return"]
    .agg(Mean_Return="mean", Volatility="std", Count="count")
    .sort_values("Mean_Return", ascending=False)
)

print("=" * 55)
print("        Market Regime Summary (sorted by Mean Return)")
print("=" * 55)
print(summary.to_string())
print("=" * 55, "\n")

# ── 6) Visualise last 500 hours ────────────────────────────────────────────
last500 = data.iloc[-500:]

fig, ax = plt.subplots(figsize=(18, 7))

# Line plot of Close price
ax.plot(last500.index, last500["Close"], color="grey", alpha=0.45,
        linewidth=0.8, label="_nolegend_")

# Scatter coloured by state
n_states = 7
cmap = cm.get_cmap("tab10", n_states)

for state_id in sorted(last500["state"].unique()):
    mask = last500["state"] == state_id
    ax.scatter(
        last500.index[mask],
        last500.loc[mask, "Close"],
        c=[cmap(state_id)],
        s=14,
        label=f"Regime {state_id}",
        edgecolors="none",
        alpha=0.85,
    )

ax.set_title("BTC-USDT  ·  Last 500 Hours  ·  HMM Market Regime Detection (7 states)",
             fontsize=14, fontweight="bold")
ax.set_xlabel("Date")
ax.set_ylabel("Close Price (USDT)")
ax.legend(loc="upper left", fontsize=9, framealpha=0.9)
ax.grid(True, alpha=0.25)
fig.tight_layout()
plt.savefig("btc_regime_detection.png", dpi=150)
plt.show()
print("📈 Chart saved to btc_regime_detection.png")

