const API = (path, opts = {}) =>
  fetch(`http://localhost:3000${path}`, { headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => r.json());

const q = s => document.querySelector(s);
const carsDiv = q("#cars");
const usersUl = q("#users");
const unassignedUl = q("#unassigned");
const totalsDiv = q("#totals");

async function loadConfig() {
  const cfg = await API("/api/config");
  q("#cfgWith").value = cfg.price_with_pass_cents;
  q("#cfgWithout").value = cfg.price_without_pass_cents;
  q("#cfgCap").value = cfg.max_car_capacity;
}

async function loadState() {
  const state = await API("/api/state");
  renderUsers(await API("/api/users"), state);
  renderDriversSelect(await API("/api/users"));
  renderCars(state.cars);
  renderUnassigned(state.users_unassigned);
  renderTotals(state.totals);
}

function renderUsers(users, state){
  usersUl.innerHTML = "";
  users.forEach(u=>{
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="row">
        <div>
          <strong>${u.name}</strong>
          ${u.is_driver ? `<span class="badge">车主</span>`: ""}
          ${u.has_pass ? `<span class="tag">年票</span>`: ""}
        </div>
        <button class="danger" data-del="${u.id}">删除</button>
      </div>`;
    li.querySelector("button").onclick = async ()=>{
      const driverCar = state.cars.find(c=>c.driver.id===u.id);
      if (driverCar) { alert("先删除该车，才能删除车主。"); return; }
      await API(`/api/users/${u.id}`, { method:"DELETE" });
      await refresh();
    };
    usersUl.appendChild(li);
  });
}

function renderDriversSelect(users){
  const sel = q("#driverSelect");
  sel.innerHTML = `<option value="">选择车主…</option>`;
  users.filter(u=>u.is_driver).forEach(d=>{
    sel.innerHTML += `<option value="${d.id}">${d.name}${d.has_pass ? "（年票）":""}</option>`;
  });
}

function renderCars(cars){
  carsDiv.innerHTML = "";
  cars.forEach(c=>{
    const card = document.createElement("div");
    card.className = "card";
    const paxList = c.passengers.map(p=>`${p.name}${p.has_pass?"<sup>🎟️</sup>":""}`).join(", ") || "<em>暂无</em>";
    card.innerHTML = `
      <div class="row">
        <div><strong>车 #${c.car_id}</strong> · 司机：${c.driver.name}${c.driver.has_pass?"<sup>🎟️</sup>":""}</div>
        <div><button data-delcar="${c.car_id}" class="danger">删除车辆</button></div>
      </div>
      <div class="row"><small class="muted">容量(含司机)：${c.capacity} · 剩余座位：${c.seats_left}</small></div>
      <div class="row"><div>乘客：${paxList}</div></div>
      <div class="row">
        <div>本车乘客票价：<span class="price">${c.passenger_price}</span>
        <small class="muted">(${c.any_pass_in_car ? "因车内有人年票": "因车内无人年票"})</small></div>
        <div>
          <select data-join="${c.car_id}" ${c.seats_left===0?"disabled":""}></select>
          <button data-joinbtn="${c.car_id}" ${c.seats_left===0?"disabled":""}>加入</button>
        </div>
      </div>
    `;
    carsDiv.appendChild(card);
  });
  // populate join selects with unassigned riders
  populateJoinSelects();
  // bind delete buttons
  carsDiv.querySelectorAll("button[data-delcar]").forEach(btn=>{
    btn.onclick = async ()=>{
      await API(`/api/cars/${btn.dataset.delcar}`, { method:"DELETE" });
      await refresh();
    };
  });
  carsDiv.querySelectorAll("button[data-joinbtn]").forEach(btn=>{
    btn.onclick = async ()=>{
      const carId = Number(btn.dataset.joinbtn);
      const sel = carsDiv.querySelector(`select[data-join="${carId}"]`);
      const userId = Number(sel.value);
      if(!userId) return;
      const res = await API(`/api/cars/${carId}/join`, { method:"POST", body: JSON.stringify({ user_id: userId }) });
      if(res.error){ alert(res.error); } else { await refresh(); }
    };
  });
}

async function populateJoinSelects(){
  const state = await API("/api/state");
  const riders = state.users_unassigned;
  document.querySelectorAll('select[data-join]').forEach(sel=>{
    sel.innerHTML = `<option value="">选择未分配乘客…</option>`;
    riders.forEach(r=>{
      sel.innerHTML += `<option value="${r.id}">${r.name}${r.has_pass?"（年票）":""}</option>`;
    });
  });
}

function renderUnassigned(list){
  unassignedUl.innerHTML = "";
  list.forEach(u=>{
    const li = document.createElement("li");
    li.innerHTML = `<div class="row"><div>${u.name}${u.has_pass?"<sup>🎟️</sup>":""}</div></div>`;
    unassignedUl.appendChild(li);
  });
}

function renderTotals(t){
  totalsDiv.innerHTML = `
    <div class="row"><div>总乘客人数：</div><strong>${t.passenger_count}</strong></div>
    <div class="row"><div>总应收（全部乘客）：</div><strong class="price">${t.total_fees}</strong></div>
  `;
}

// ----- Forms -----
q("#configForm").onsubmit = async (e)=>{
  e.preventDefault();
  const body = {
    price_with_pass_cents: Number(q("#cfgWith").value),
    price_without_pass_cents: Number(q("#cfgWithout").value),
    max_car_capacity: Number(q("#cfgCap").value)
  };
  const res = await API("/api/config", { method:"POST", body: JSON.stringify(body) });
  if(res.error) alert(res.error); else alert("配置已更新！");
};

q("#userForm").onsubmit = async (e)=>{
  e.preventDefault();
  const body = {
    name: q("#name").value.trim(),
    is_driver: q("#isDriver").checked,
    has_pass: q("#hasPass").checked
  };
  if(!body.name) return;
  const res = await API("/api/users", { method:"POST", body: JSON.stringify(body) });
  if(res.error) alert(res.error);
  e.target.reset();
  await refresh();
};

q("#carForm").onsubmit = async (e)=>{
  e.preventDefault();
  const body = {
    driver_id: Number(q("#driverSelect").value),
    capacity: Number(q("#capacity").value)
  };
  const res = await API("/api/cars", { method:"POST", body: JSON.stringify(body) });
  if(res.error) alert(res.error);
  e.target.reset();
  await refresh();
};

q("#autoAssign").onclick = async ()=>{
  await API("/api/auto-assign", { method:"POST" });
  await refresh();
};
q("#purge").onclick = async ()=>{
  if(!confirm("确定清空所有数据？")) return;
  await API("/api/purge", { method:"POST" });
  await refresh();
};
q("#refresh").onclick = refresh;

async function refresh(){
  await loadConfig();
  await loadState();
}

(async function init(){
  await loadConfig();
  await loadState();
})();