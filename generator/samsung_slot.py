import re
import requests
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials, firestore

COLLECTION_NAME = 'horleyTech_OnlineInventories'
VENDOR_NAME = 'Slot'

PRODUCT_NAMES = [
    'samsung galaxy s24 ultra 512gb',
    'samsung galaxy s24 ultra 256gb',
    'samsung galaxy s23 ultra 512gb',
    'samsung galaxy s23 ultra 256gb',
]


def init_firestore():
    if not firebase_admin._apps:
        cred = credentials.Certificate('firebase-key.json')
        firebase_admin.initialize_app(cred)
    return firestore.client()


def extract_price(price_text: str):
    digits = re.sub(r'[^0-9]', '', price_text or '')
    return digits if digits else 'Available'


def scrape_slot_price(product_name: str):
    url = f"https://slot.ng/catalogsearch/result/?q={product_name.replace(' ', '+')}"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')

    cards = soup.select('div.product-info')
    products = []
    for card in cards[:5]:
      name_el = card.select_one('h3.product-name')
      price_el = card.select_one('span.price')
      if not name_el:
          continue
      device_name = name_el.get_text(strip=True)
      products.append({
          'Category': 'Samsung',
          'Device Type': device_name,
          'Condition': 'Brand New',
          'SIM Type/Model/Processor': 'N/A',
          'Storage Capacity/Configuration': 'N/A',
          'Regular price': extract_price(price_el.get_text(strip=True) if price_el else ''),
          'DatePosted': firestore.SERVER_TIMESTAMP,
          'Link': url,
          'groupName': 'Slot Scraper',
      })

    if not products:
        products.append({
            'Category': 'Samsung',
            'Device Type': product_name,
            'Condition': 'Brand New',
            'SIM Type/Model/Processor': 'N/A',
            'Storage Capacity/Configuration': 'N/A',
            'Regular price': 'Available',
            'DatePosted': firestore.SERVER_TIMESTAMP,
            'Link': url,
            'groupName': 'Slot Scraper',
        })

    return products


def save_to_firestore(all_products):
    db = init_firestore()
    doc_ref = db.collection(COLLECTION_NAME).document(VENDOR_NAME)
    existing = doc_ref.get().to_dict() if doc_ref.get().exists else {}
    existing_products = existing.get('products', [])

    payload = {
        'vendorId': VENDOR_NAME,
        'shareableLink': f'/vendor/{VENDOR_NAME}',
        'lastUpdated': firestore.SERVER_TIMESTAMP,
        'products': existing_products + all_products,
    }
    doc_ref.set(payload, merge=True)


if __name__ == '__main__':
    scraped = []
    for item in PRODUCT_NAMES:
        scraped.extend(scrape_slot_price(item))
    save_to_firestore(scraped)
    print(f'Saved {len(scraped)} items to {COLLECTION_NAME}/{VENDOR_NAME}')
