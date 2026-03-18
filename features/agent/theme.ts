import { Fonts } from "@/constants/theme";
import type { useMarkdownHookOptions } from "react-native-marked";

export const markedDarkOptions: useMarkdownHookOptions = {
  colorScheme: "dark",
  theme: {
    colors: {
      background: "transparent",
      text: "#CCCCCC",
      link: "#58a6ff",
      border: "#2A2A2A",
      code: "#1A1A1A",
      codeText: "#c9d1d9",
      blockquoteBorder: "#333333",
      blockquoteBackground: "transparent",
      hr: "#2A2A2A",
    },
    spacing: {
      paragraph: 4,
      heading: 4,
      code: 8,
      blockquote: 8,
      list: 2,
      listItem: 2,
      table: 8,
      tableCell: 4,
      hr: 8,
    },
  },
  styles: {
    h1: {
      fontSize: 20,
      lineHeight: 28,
      fontFamily: Fonts.sansBold,
      fontWeight: "bold",
      color: "#E8E8E8",
    },
    h2: {
      fontSize: 18,
      lineHeight: 26,
      fontFamily: Fonts.sansBold,
      fontWeight: "bold",
      color: "#E8E8E8",
    },
    h3: {
      fontSize: 16,
      lineHeight: 24,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "600",
      color: "#E8E8E8",
    },
    h4: {
      fontSize: 15,
      lineHeight: 22,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "600",
      color: "#E8E8E8",
    },
    h5: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "600",
      color: "#E8E8E8",
    },
    h6: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sansMedium,
      fontWeight: "600",
      color: "#E8E8E8",
    },
    paragraph: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sans,
      color: "#CCCCCC",
    },
    strong: {
      fontFamily: Fonts.sansBold,
      fontWeight: "bold",
      color: "#E8E8E8",
    },
    em: {
      fontFamily: Fonts.sansItalic,
      fontStyle: "italic",
    },
    del: {
      fontFamily: Fonts.sans,
      textDecorationLine: "line-through",
      color: "#999999",
    },
    link: {
      fontFamily: Fonts.sans,
      color: "#58a6ff",
    },
    codespan: {
      fontFamily: Fonts.mono,
      fontSize: 12,
      color: "#c9d1d9",
      backgroundColor: "#1A1A1A",
    },
    code: {
      backgroundColor: "#1A1A1A",
      borderRadius: 8,
      padding: 12,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: "#333333",
      paddingLeft: 12,
    },
    list: {
      gap: 2,
    },
    li: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sans,
      color: "#CCCCCC",
    },
    hr: {
      marginVertical: 8,
      height: 1,
      backgroundColor: "#2A2A2A",
    },
    table: {
      borderColor: "#2A2A2A",
    },
    tableCell: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      lineHeight: 18,
      color: "#CCCCCC",
    },
  },
};

export const markedLightOptions: useMarkdownHookOptions = {
  colorScheme: "light",
  theme: {
    colors: {
      background: "transparent",
      text: "#1A1A1A",
      link: "#0366d6",
      border: "#E8E8E8",
      code: "#F6F6F6",
      codeText: "#24292e",
      blockquoteBorder: "#DDDDDD",
      blockquoteBackground: "transparent",
      hr: "#E8E8E8",
    },
    spacing: {
      paragraph: 4,
      heading: 4,
      code: 8,
      blockquote: 8,
      list: 2,
      listItem: 2,
      table: 8,
      tableCell: 4,
      hr: 8,
    },
  },
  styles: {
    h1: {
      fontSize: 20,
      lineHeight: 28,
      fontFamily: Fonts.sansBold,
      fontWeight: "bold",
      color: "#1A1A1A",
    },
    h2: {
      fontSize: 18,
      lineHeight: 26,
      fontFamily: Fonts.sansBold,
      fontWeight: "bold",
      color: "#1A1A1A",
    },
    h3: {
      fontSize: 16,
      lineHeight: 24,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "600",
      color: "#1A1A1A",
    },
    h4: {
      fontSize: 15,
      lineHeight: 22,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "600",
      color: "#1A1A1A",
    },
    h5: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "600",
      color: "#1A1A1A",
    },
    h6: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sansMedium,
      fontWeight: "600",
      color: "#1A1A1A",
    },
    paragraph: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sans,
      color: "#1A1A1A",
    },
    strong: {
      fontFamily: Fonts.sansBold,
      fontWeight: "bold",
      color: "#111111",
    },
    em: {
      fontFamily: Fonts.sansItalic,
      fontStyle: "italic",
    },
    del: {
      fontFamily: Fonts.sans,
      textDecorationLine: "line-through",
      color: "#666666",
    },
    link: {
      fontFamily: Fonts.sans,
      color: "#0366d6",
    },
    codespan: {
      fontFamily: Fonts.mono,
      fontSize: 12,
      color: "#24292e",
      backgroundColor: "#F4F4F4",
    },
    code: {
      backgroundColor: "#F6F6F6",
      borderRadius: 8,
      padding: 12,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: "#DDDDDD",
      paddingLeft: 12,
    },
    list: {
      gap: 2,
    },
    li: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Fonts.sans,
      color: "#1A1A1A",
    },
    hr: {
      marginVertical: 8,
      height: 1,
      backgroundColor: "#E8E8E8",
    },
    table: {
      borderColor: "#E8E8E8",
    },
    tableCell: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      lineHeight: 18,
      color: "#1A1A1A",
    },
  },
};
