import re
import requests
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials, firestore

COLLECTION_NAME = 'horleyTech_OnlineInventories'
VENDOR_NAME = 'Jiji'
QUERIES = [
    'Apple iWatch Series 8',
    'Apple iWatch Ultra 2',
    'Samsung Galaxy Watch 6',
]


def init_firestore():
    if not firebase_admin._apps:
        cred = credentials.Certificate('firebase-key.json')
        firebase_admin.initialize_app(cred)
    return firestore.client()


def normalize_price(value: str):
    digits = re.sub(r'[^0-9]', '', value or '')
    return digits if digits else 'Available'


def scrape_jiji(query: str):
    url = f"https://jiji.ng/search?query={query.replace(' ', '%20')}"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')

    listings = soup.select('div.b-list-advert-base__data__header')
    products = []
    for item in listings[:10]:
        title = item.select_one('.qa-advert-title')
        price = item.select_one('.qa-advert-price')
        if not title:
            continue
        products.append({
            'Category': 'Smartwatch',
            'Device Type': title.get_text(strip=True),
            'Condition': 'Used/New (Marketplace)',
            'SIM Type/Model/Processor': 'N/A',
            'Storage Capacity/Configuration': 'N/A',
            'Regular price': normalize_price(price.get_text(strip=True) if price else ''),
            'DatePosted': firestore.SERVER_TIMESTAMP,
            'Link': url,
            'groupName': 'Jiji Scraper',
        })
    return products


def save_to_firestore(products):
    db = init_firestore()
    doc_ref = db.collection(COLLECTION_NAME).document(VENDOR_NAME)
    snap = doc_ref.get()
    existing = snap.to_dict() if snap.exists else {}
    existing_products = existing.get('products', [])

    doc_ref.set(
        {
            'vendorId': VENDOR_NAME,
            'shareableLink': f'/vendor/{VENDOR_NAME}',
            'lastUpdated': firestore.SERVER_TIMESTAMP,
            'products': existing_products + products,
        },
        merge=True,
    )


if __name__ == '__main__':
    all_products = []
    for q in QUERIES:
        all_products.extend(scrape_jiji(q))
    save_to_firestore(all_products)
    print(f'Saved {len(all_products)} products to {COLLECTION_NAME}/{VENDOR_NAME}')
