import time
import json
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from bs4 import BeautifulSoup

def get_product_info(product_name):
    # Function to scrape Jumia search results for the given product_name

    # Use a headless browser (Chrome in this case)
    driver = webdriver.Chrome()

    base_url = 'https://jiji.ng/search?query='
    search_url = base_url + product_name.replace(' ', '%20')

    try:
        driver.get(search_url)

        # Scroll down to load more products dynamically
        for _ in range(15):  # Adjust the number of scrolls based on your needs
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)  # Adjust the sleep time if needed

        soup = BeautifulSoup(driver.page_source, 'html.parser')

        product_elements = soup.find_all('div', class_='b-list-advert-base__data__header')

        if not product_elements:
            print(f"Product not available for '{product_name}'.")
            return {
                'first_three_lowest': [],
                'first_three_highest': []
            }

        product_data = []
        for element in product_elements:
            name_element = element.find('div', class_='b-advert-title-inner qa-advert-title b-advert-title-inner--div')
            price_element = element.find('div', class_='qa-advert-price')

            if name_element and price_element:
                # Special case for "apple iphone 13 6.1" 128gb"
                if product_name in [
                    'SAMSUNG galaxy BUDS',
                    'SAMSUNG galaxy BUDS+',
                    'Samsung Galaxy Buds2',
                    'BEATS FIT PRO',
                    'BEATS STUDIO BUDS',
                    'Beats POWERBEATS PRO',
                    ]:
                    name_words = name_element.text.lower().split()[:3]
                    input_words = product_name.lower().split()[:3]

                elif product_name in [
                    'Samsung AKG Type C Headphones',
                    ]:
                    name_words = name_element.text.lower().split()[:5]
                    input_words = product_name.lower().split()[:5]

                elif product_name in [
                    'Samsung Galaxy Buds Live - Mystic Black',
                    ]:
                    name_words = name_element.text.lower().split()[:6]
                    input_words = product_name.lower().split()[:6]
                else:
                    name_words = name_element.text.lower().split()[:4]
                    input_words = product_name.lower().split()[:4]

                # Check if the first four words match
                if name_words == input_words:
                    name = name_element.text.strip()
                    price = price_element.text.strip()

                    product_data.append({'name': name,'price': price})

        # Sort products by price
        sorted_products = sorted(product_data, key=lambda x: float(x['price'].replace('₦', '').replace(',', '')))

        # Extract the first three lowest and the first three highest
        first_three_lowest = sorted_products[:3]
        first_three_highest = sorted_products[-3:]

        return {
            'first_three_lowest': first_three_lowest,
            'first_three_highest': first_three_highest
        }

    except Exception as e:
        print(f"Error during the request: {e}")
        return None
    finally:
        driver.quit()

    


# Rest of the code remains the same
def print_product_info(products, label):
    if products:
        print(f"\n{label} Product Information:")
        for product in products:
            print(f"Name: {product['name']}\n{'-'*30}\nPrice: {product['price']}\n{'-'*30}")
    else:
        print(f"\nNo information available for {label}.")

if __name__ == "__main__":
    product_names = [
            'Apple Airpods 2 Case charging brand new',
            'New Apple Airpods Pro 1st Gen',
            'Airpods 3 New 2022',
            'Airpods Pro 2nd Generation ',
            'SAMSUNG galaxy BUDS 2 brand new',
            'SAMSUNG galaxy BUDS2 pro brand new',
            'SAMSUNG galaxy BUDS',
            'SAMSUNG galaxy BUDS LIVE',
            'SAMSUNG galaxy BUDS+',
            'SAMSUNG galaxy BUDS PRO',
            'Samsung Galaxy Buds Live - Mystic Black',
            'Samsung Galaxy Buds2',
            'Samsung AKG Type C Headphones',
            'BEATS FIT PRO',
            'BEATS STUDIO BUDS',
            'Beats POWERBEATS PRO',
    ]
    sound_table = []

    for index, product_name in enumerate(product_names, start=1):
        print(f"\n*** Searching for '{product_name}' ***")
        results = get_product_info(product_name)
    
    # Check if results is not None
        if results is not None:
            # Extract prices and ensure there are at least three prices for highest and lowest
            prices_lowest = [float(product['price'].replace('₦', '').replace(',', '').replace('\xa0', '').replace('NGN', '')) for product in results['first_three_lowest']]
            prices_lowest += [0.0] * (3 - len(prices_lowest))

            prices_highest = [float(product['price'].replace('₦', '').replace(',', '').replace('\xa0', '').replace('NGN', '')) for product in results['first_three_highest']]
            prices_highest += [0.0] * (3 - len(prices_highest))

            # Assign specific product names based on the index
            assigned_product_name = {
                1: 'Apple AIRPOD 2 CHARGING CASE',
                2: 'Apple AIRPOD PRO 1ST GEN',
                3: 'Apple AIRPODS 3 2021',
                4: 'Apple AIRPODS PRO 2ND GEN',
                5: 'SAMSUNG BUDS 2',
                6: 'SAMSUNG BUDS 2 PRO',
                7: 'SAMSUNG EARBUDS',
                8: 'SAMSUNG EARBUDS LIVE',
                9: 'SAMSUNG EARBUDS PLUS',
                10: 'SAMSUNG EARBUDS PRO',
                11: 'SAMSUNG EARBUDS pro',
                12: 'Samsung Galaxy Buds Live – Mystic Black',
                13: 'Samsung Galaxy Buds2',
                14: 'Samsung usb c akg earphones',
                15: 'BEATS FIT PRO',
                16: 'BEATS STUDIO BUDS',
                17: 'POWERBEATS PRO',
                
            }.get(index, f"Unknown Product {index}")


            # Constructing the JavaScript format
            entry = {
                'id': index,
                'Pname': assigned_product_name,
                'Link': f"https://jiji.ng/search?query={product_name.replace(' ', '+')}",
                'H1': f"{prices_highest[0]:,.0f}",
                'H2': f"{prices_highest[1]:,.0f}",
                'H3': f"{prices_highest[2]:,.0f}",
                'L1': f"{prices_lowest[0]:,.0f}",
                'L2': f"{prices_lowest[1]:,.0f}",
                'L3': f"{prices_lowest[2]:,.0f}",
            }

            sound_table.append(entry)

    # Allow further testing by leaving the input part
    
    with open('soundJIJI.js', 'w') as js_file:
        js_file.write("export const soundTable = " + json.dumps(sound_table, indent=2))


