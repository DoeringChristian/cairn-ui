import type { ButtonHTMLAttributes } from "react";
import { Camera, SlidersHorizontal, MoreHorizontal } from "lucide-react";
import "./card-actions.css";

type Action = "screenshot" | "settings" | "menu";
const icons = {
  screenshot: <Camera size={14} aria-hidden="true" />,
  settings: <SlidersHorizontal size={13} aria-hidden="true" />,
  menu: <MoreHorizontal size={16} aria-hidden="true" />,
};

/** Prism's three card controls, shared by run, workspace and published cards. */
export function CardActionButton({action, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {action: Action}) {
  return <button type="button" {...props} className="cairn-card-action-button">{icons[action]}</button>;
}
