const ITELS_TEHRAN_URL =
  "https://backoffice.ieltstehran.com/api/public/events-list/exam?page={page}";
import { Observer, Result } from "./Idp";
import { Bot } from "grammy";
import axios from "axios";
import cron from "node-cron";
import { createLogger, transports, format } from "winston";
import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import pLimit from "p-limit";

interface ExamEntry {
  status: string;
  examName: string;
  examType: string;
  testType: string;
  examDate: string;
  location: string;
  cost: string;
}

interface ScrapeResult {
  completedData: ExamEntry[];
  incompleteData: ExamEntry[];
  hasError: boolean;
  message: string;
}

// Incomplete data history for hourly checks
let incompleteDataHistory: boolean[] = [];
const CONCURRENCY_LIMIT = 5; // Limit concurrent requests

const PAGE_RANGE_END: number = parseInt(process.env.PAGE_RANGE_END || "11", 10);
const REQUEST_DELAY: number =
  parseFloat(process.env.REQUEST_DELAY || "1") * 1000;

const limit = pLimit(CONCURRENCY_LIMIT);
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class IELTS_TEHRAN implements Observer {
  constructor() {}

  async doYourThing(): Promise<Result> {
    try {
      const completedData: ExamEntry[] = [];
      const incompleteData: ExamEntry[] = [];

      const PAGE_RANGE_END = 6;
      const pages = Array.from({ length: PAGE_RANGE_END - 1 }, (_, i) => i + 1);
      let requestCount = 0;

      const scrapePromises = pages.map((page) =>
        limit(async () => {
          if (requestCount > 0) {
            await delay(REQUEST_DELAY);
          }
          requestCount++;
          return this.scrapePage(page);
        })
      );

      const results = await Promise.all(scrapePromises);
      let hasError2 = false;
      let message2 = "";
      for (const {
        completedData: pageCompleted,
        incompleteData: pageIncomplete,
        hasError,
        message,
      } of results) {
        completedData.push(...pageCompleted);
        incompleteData.push(...pageIncomplete);
        if (hasError) {
          hasError2 = true;
          message2 = `IELTS_TEHRAN - Error occurred while scraping page: ${message}`;
          break;
        }
      }

      if (hasError2) {
        return {
          hasError: true,
          site: "IELTS_TEHRAN",
          data: message2,
          found: false,
          link: "",
        };
      }

      if (incompleteData.length > 0) {
        const tests = incompleteData
          .map(
            (entity) =>
              `Name: ${entity.examName}\n` +
              `Status: ${entity.status}\n` +
              `Exam Date: ${new Intl.DateTimeFormat("fa-IR").format(
                new Date(entity.examDate)
              )}\n`
          )
          .join("\n");

        return {
          found: true,
          site: "IELTS_TEHRAN در سایت خود",
          data: tests,
          hasError: false,
          link: "https://ieltstehran.com/computer-delivered-ielts-exam/",
        };
      }

      return {
        found: false,
        hasError: false,
        site: "IELTS_TEHRAN",
        data: "No test found",
        link: "",
      };
    } catch (error) {
      console.error("Error fetching IELTS_TEHRAN data:", error);
      return {
        found: false,
        hasError: true,
        site: "IELTS_TEHRAN",
        data: `An error occurred while fetching data from IELTS_TEHRAN: ${error}`,
        link: "",
      };
    }
  }

  async scrapePage(page: number): Promise<ScrapeResult> {
    const completedData: ExamEntry[] = [];
    const incompleteData: ExamEntry[] = [];
    const url = ITELS_TEHRAN_URL.replace("{page}", page.toString());

    try {
      const response = await axios.get(url, { timeout: 20000 });
      if (response.status === 200) {
        const jsonData = response.data;

        // Check if data array exists
        const exams = jsonData.data || [];

        if (exams.length) {
          for (const exam of exams) {
            try {
              // Validate required fields
              if (
                !exam.start_date ||
                !exam.product_name ||
                !exam.location_en_name ||
                !exam.product_price_formated ||
                !exam.capacity_status
              ) {
                throw new Error("Missing required fields in exam data");
              }

              const entry: ExamEntry = {
                status: exam.capacity_status,
                examName: exam.product_name,
                examType: exam.product_name.includes("Academic")
                  ? "Academic"
                  : "General",
                testType: exam.is_online === 1 ? "Online" : "Computer",
                examDate: exam.start_date,
                location: exam.location_en_name,
                cost: exam.product_price_formated,
              };

              // Validation: Check if exam is completed
              if (
                exam.capacity_status === "تکمیل" ||
                exam.capacity_status_code === 0
              ) {
                completedData.push(entry);
              } else {
                incompleteData.push(entry);
              }
            } catch (error) {
              return {
                hasError: true,
                message: `IELTS_TEHRAN - Error parsing exam on page ${page}: ${error}`,
                completedData: [],
                incompleteData: [],
              };
            }
          }
        } else {
          return {
            hasError: false,
            message: `IELTS_TEHRAN - No exams found on page ${page}`,
            completedData: [],
            incompleteData: [],
          };
        }
      } else {
        return {
          hasError: true,
          message: `IELTS_TEHRAN - Failed to retrieve page ${page}. Status code: ${response.status}`,
          completedData: [],
          incompleteData: [],
        };
      }
    } catch (error) {
      return {
        hasError: true,
        message: `IELTS_TEHRAN - Error occurred while scraping data, ${error}`,
        completedData: [],
        incompleteData: [],
      };
    }

    return { completedData, incompleteData, hasError: false, message: "" };
  }
}
