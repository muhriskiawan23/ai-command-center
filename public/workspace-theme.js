/* Display preference only; no messages, account data or credits are stored. */
(() => {
  let preference="light";
  try { preference=localStorage.getItem("borai-theme-preference")||"light"; } catch {}
  if(!["light","dark","auto"].includes(preference))preference="light";
  const apply=()=>{
    const theme=preference==="auto"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):preference;
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",theme==="dark"?"#181a1f":"#ffffff");
  };
  window.BORTheme={get preference(){return preference;},set(value){
    if(!["light","dark","auto"].includes(value))return;
    preference=value;try{localStorage.setItem("borai-theme-preference",value);}catch{}apply();
  }};
  apply();matchMedia("(prefers-color-scheme: dark)").addEventListener("change",apply);
})();
