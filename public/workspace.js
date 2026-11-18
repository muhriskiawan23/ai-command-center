/* Workspace disclosures enhance existing controls; billing/auth stay server-owned. */
(() => {
  const menus=[...document.querySelectorAll(".composer-menu")];
  const close=(menu,focus=false)=>{if(!menu?.open)return;menu.open=false;if(focus)menu.querySelector("summary")?.focus();};
  document.getElementById("themePreference").value=window.BORTheme.preference;
  document.getElementById("themePreference").addEventListener("change",event=>window.BORTheme.set(event.target.value));
  document.addEventListener("toggle",event=>{
    const menu=event.target;
    if(!menu.matches?.(".composer-menu,.history-menu")||!menu.open)return;
    document.querySelectorAll(".composer-menu[open],.history-menu[open]").forEach(other=>{if(other!==menu)close(other);});
    if(menu.matches(".history-menu")) menu.querySelector(".history-actions")?.scrollIntoView({block:"nearest"});
  },true);
  document.addEventListener("click",event=>{
    document.querySelectorAll(".composer-menu[open],.history-menu[open]").forEach(menu=>{
      if(!menu.contains(event.target))close(menu);
      else if(event.target.closest("button"))close(menu);
    });
  });
  document.addEventListener("keydown",event=>{
    if(event.key!=="Escape")return;
    const opened=[...document.querySelectorAll(".composer-menu[open],.history-menu[open]")];
    if(opened.length){event.preventDefault();event.stopPropagation();opened.forEach(menu=>close(menu,true));}
  },true);
  document.getElementById("newChat").addEventListener("click",()=>menus.forEach(menu=>close(menu)));
  // Menus do not submit forms or start any model/payment operation.
})();
