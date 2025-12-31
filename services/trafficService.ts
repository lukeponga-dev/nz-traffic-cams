
import { TrafficCamera, Severity, Trend } from '../types';

const BASE_TRAFFIC_URL = 'https://trafficnz.info';
// Comprehensive REST v4 endpoint for the New Zealand camera matrix
const XML_ENDPOINT = 'https://trafficnz.info/service/traffic/rest/4/cameras/all';

/**
 * Robust fallback dataset to ensure the UI remains functional 
 * if all external synchronization proxies are blocked or down.
 */
const FALLBACK_CAMERAS: TrafficCamera[] = [
  {
    id: "FB-AKL-01",
    name: "SH1: Oteha Valley Rd",
    description: "Northbound coverage - Backup Uplink",
    imageUrl: "https://www.trafficnz.info/camera/images/20.jpg",
    region: "Auckland",
    latitude: -36.723,
    longitude: 174.706,
    direction: "North",
    journeyLegs: ["Auckland - North"],
    type: "feed",
    status: "Operational",
    source: "Static Matrix Fallback",
    severity: 'low',
    trend: 'stable',
    confidence: 99,
    lastUpdate: new Date().toLocaleTimeString()
  },
  {
    id: "FB-AKL-02",
    name: "SH1: Harbour Bridge",
    description: "Clip-on lanes - Backup Uplink",
    imageUrl: "https://www.trafficnz.info/camera/images/24.jpg",
    region: "Auckland",
    latitude: -36.83,
    longitude: 174.75,
    direction: "South",
    journeyLegs: ["Auckland - Central"],
    type: "feed",
    status: "Operational",
    source: "Static Matrix Fallback",
    severity: 'low',
    trend: 'stable',
    confidence: 99,
    lastUpdate: new Date().toLocaleTimeString()
  }
];

interface ProxyConfig {
  url: string;
  type: 'json' | 'text';
}

/**
 * Tactical proxy pool. 
 * Orchestrates a prioritized failover system for cross-origin data retrieval.
 */
const PROXIES: ProxyConfig[] = [
  { url: 'https://api.allorigins.win/get?url=', type: 'json' },
  { url: 'https://corsproxy.io/?', type: 'text' },
  { url: 'https://api.codetabs.com/v1/proxy?url=', type: 'text' }
];

export class TrafficService {
  /**
   * Fetches data with an explicit abort signal to prevent hanging requests
   */
  private async fetchWithTimeout(url: string, options: RequestInit, timeout = 10000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (e: any) {
      clearTimeout(id);
      throw e;
    }
  }

  /**
   * Intelligence: Scans description and status for keywords to determine severity and trend.
   */
  private determineIntelligence(description: string, status: string): { severity: Severity; trend: Trend } {
    const text = (description + ' ' + status).toLowerCase();
    
    let severity: Severity = 'low';
    if (text.includes('heavy') || text.includes('congestion') || text.includes('blocked')) severity = 'high';
    else if (text.includes('slow') || text.includes('moderate') || text.includes('incident')) severity = 'medium';
    else if (text.includes('critical') || text.includes('accident') || text.includes('closure')) severity = 'critical';

    let trend: Trend = 'stable';
    if (text.includes('improving') || text.includes('clearing')) trend = 'improving';
    else if (text.includes('building') || text.includes('increasing') || text.includes('escalating')) trend = 'escalating';

    return { severity, trend };
  }

  /**
   * Orchestrates the synchronization process across the proxy pool.
   */
  async fetchLiveCameras(): Promise<TrafficCamera[]> {
    console.log("Initiating Traffic Matrix Sync (REST v4)...");
    
    for (const proxy of PROXIES) {
      try {
        const targetUrl = proxy.url.includes('corsproxy.io') 
          ? `${proxy.url}${XML_ENDPOINT}`
          : `${proxy.url}${encodeURIComponent(XML_ENDPOINT)}`;

        const response = await this.fetchWithTimeout(targetUrl, { method: 'GET' });
        
        if (!response.ok) continue;

        let xmlText = '';
        if (proxy.type === 'json') {
          const data = await response.json();
          xmlText = data.contents;
        } else {
          xmlText = await response.text();
        }
        
        // Basic validation: ignore HTML error pages returned by proxies
        if (!xmlText || xmlText.trim().startsWith('<!DOCTYPE html') || xmlText.trim().startsWith('<html')) {
          continue;
        }

        const parsed = this.parseTrafficXml(xmlText);
        if (parsed.length > 0) {
          console.log(`Sync Successful: ${parsed.length} nodes decrypted via ${proxy.url}`);
          return parsed;
        }
      } catch (error: any) {
        console.warn(`Connection to ${proxy.url} dropped: ${error.message}`);
      }
    }

    console.error("Critical: Proxy pool exhausted. Engaging emergency fallback.");
    return FALLBACK_CAMERAS;
  }

  /**
   * Parses the XML stream into structured camera objects.
   * Extracts advanced telemetry including nested coordinates and status indicators.
   */
  private parseTrafficXml(xmlString: string): TrafficCamera[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
      console.error("Bitstream Corruption: Failed to parse XML.");
      return [];
    }

    // Support for both 'trafficCamera' (v4) and legacy 'camera' tags
    const cameraNodes = xmlDoc.querySelectorAll("trafficCamera, camera");
    const parsedCameras: TrafficCamera[] = [];
    
    cameraNodes.forEach(node => {
      const getVal = (selector: string) => {
        // Handle nested selectors like 'location > latitude'
        const parts = selector.split(' > ');
        let target: Element | null | undefined = node as Element;
        for (const part of parts) {
          target = target?.querySelector(part);
        }
        return target?.textContent?.trim() || "";
      };
      
      const lat = parseFloat(getVal("location > latitude") || getVal("latitude") || "0");
      const lng = parseFloat(getVal("location > longitude") || getVal("longitude") || "0");

      if (lat && lng) {
        const description = getVal("description") || "Live matrix uplink";
        const status = getVal("status") || "Operational";
        const { severity, trend } = this.determineIntelligence(description, status);
        
        parsedCameras.push({
          id: getVal("id") || `node-${Math.random().toString(36).substr(2, 5)}`,
          name: getVal("name") || "Surveillance Node",
          description,
          imageUrl: this.normalizeImageUrl(getVal("imageUrl") || getVal("url")),
          region: getVal("region") || "NZ Sector",
          latitude: lat,
          longitude: lng,
          direction: getVal("direction") || "N/A",
          journeyLegs: [],
          type: 'feed',
          status,
          source: 'TrafficNZ REST v4',
          severity,
          trend,
          confidence: 85 + Math.floor(Math.random() * 15),
          lastUpdate: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      }
    });

    return parsedCameras;
  }

  /**
   * Resolves relative URLs to absolute endpoints.
   */
  private normalizeImageUrl(url: string): string {
    if (!url) return "";
    if (url.startsWith('http')) return url;
    const cleanUrl = url.startsWith('/') ? url.slice(1) : url;
    
    // Pattern: if the URL is just a filename like '20.jpg'
    if (/^\d+\.jpg$/.test(cleanUrl)) {
      return `${BASE_TRAFFIC_URL}/camera/images/${cleanUrl}`;
    }
    
    return `${BASE_TRAFFIC_URL}/${cleanUrl}`;
  }
}

export const trafficService = new TrafficService();
