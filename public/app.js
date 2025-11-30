const socket = io();
const oppsEl = document.getElementById('opps');
const logEl = document.getElementById('log');
const btnRefresh = document.getElementById('btn-refresh');

function addLog(msg) {
  const d = document.createElement('div');
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(d);
}

socket.on('connect', () => {
  addLog('Connected to server');
  socket.emit('get_exchanges');
});

socket.on('ticker', (data) => {
  // optional small update for live tickers
});

socket.on('opportunity', (opp) => {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <strong>${opp.pair}</strong><br/>
    Buy: ${opp.bestBuy.exchange} @ ${opp.bestBuy.ask}<br/>
    Sell: ${opp.bestSell.exchange} @ ${opp.bestSell.bid}<br/>
    Spread: ${(opp.spread*100).toFixed(3)}%<br/>
    <div style="margin-top:8px;">
      <button class="btn-exec">Execute (manual)</button>
    </div>
  `;
  const btn = el.querySelector('.btn-exec');
  btn.onclick = () => {
    addLog(`Manual execute requested for ${opp.pair}`);
    socket.emit('execute', opp);
  };
  oppsEl.prepend(el);
});

socket.on('exec_result', (res) => {
  addLog('Execution result: ' + JSON.stringify(res));
});

socket.on('log', (msg) => {
  addLog(msg);
});

socket.on('exchanges', (list) => {
  addLog('Exchanges available: ' + list.join(', '));
});

btnRefresh.onclick = async () => {
  try {
    const res = await fetch('/api/config');
    const j = await res.json();
    addLog('Config: ' + JSON.stringify(j));
  } catch (e) {
    addLog('Failed to refresh config: ' + e);
  }
};
