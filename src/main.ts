import { createApp } from "vue";
import "./style.css";
import "./styles/shrine-panels.css";

const { default: App } = await (/^\/admin\/?$/.test(location.pathname)
  ? import("./admin/AdminApp.vue")
  : import("./App.vue"));
createApp(App).mount("#app");
