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
                if product_name == 'apple iphone 13 6.1" 128gb' or 'apple iphone 13 6.1" 256gb' or 'apple iphone 12 pro - 6.1" 128gb' or 'apple iphone 12 - 6.1" 256gb':
                    name_words = name_element.text.lower().split()[:6]
                    input_words = product_name.lower().split()[:6]
                else:
                    name_words = name_element.text.lower().split()[:7]
                    input_words = product_name.lower().split()[:7]

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
        "New apple iphone 15 pro max 256 gb",
        "New apple iphone 15 pro max 512 gb",
        "New apple iphone 15 pro max 1 tb",
        "New apple iphone 15 pro 128 gb",
        "New apple iphone 15 pro 256 gb",
        'New apple iphone 15 128 gb',
        "New apple iphone 15 256 gb",
        "New apple iphone 14 pro max 128 gb",
        "New apple iphone 14 pro max 256 gb",
        "New apple iphone 14 pro max 512 gb",
        "New apple iphone 14 pro max 1tb",
        'New apple iphone 14 pro 128 gb',
        'New apple iphone 14 pro 256 gb',
        'New apple iphone 14 pro 512 gb',
        'New apple iphone 14 pro 1 tb',
        'New Apple IPhone 14 Plus 128 gb',
        'New Apple IPhone 14 Plus 256 gb',
        "New apple iphone 13 pro max 128 gb",
        "New apple iphone 13 pro max 256 gb",
        "New apple iphone 13 pro max 512 gb",
        "New apple iphone 13 pro max 1 tb",
        'New apple iphone 13 pro 128 gb',
        'New apple iphone 13 pro 256 gb',
        'New apple iphone 13 128 gb',
        'New apple iphone 13 256 gb',
        "New apple iphone 13 mini 256 gb",
        "New apple iphone 12 pro max 128 gb",
        "New apple iphone 12 pro max 256 gb",
        "New apple iphone 12 pro max 512 gb",
        'New apple iphone 12 pro 128 gb',
        'New apple iphone 12 pro 256 gb',
        'New apple iphone 12 128 gb',
        'New apple iphone 12 64 gb',
        "New apple iphone 11 pro max 256 gb",
        "New apple iphone 11 pro max 64 gb",
        'New apple IPhone 11 Pro 256 gb',
        'New Apple IPhone 11 Pro  64 gb',
        'New Apple IPhone 11 256 gb',
        'New Apple IPhone 11 128 gb',
        'New Apple IPhone 11 64 gb',
        'New apple iphone xs max 256 gb',
        'New apple iphone xs max 64 gb',
        'New apple iphone xr 128 gb',
        'New apple iphone xr 64 gb',
        'New apple iphone xs 128 gb',
        'apple iphone xs 64 gb',
        'Apple IPhone X 64 GB',
        'Apple IPhone X 256 GB',
        'Apple IPhone 8 plus 256 gb',
        'Apple IPhone 8 plus 64 gb',
        'Apple IPhone 8 64 gb',
        'Apple IPhone 8 256 gb',
        'Apple IPhone 7 plus 128 gb',
        'Apple IPhone 7 plus 32 gb',
        'Apple IPhone 7 128 gb',
        'Apple IPhone 7 32 gb',
    ]
    iphone_table = []

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
                1: "apple iphone 15 pro max 256 gb",
                2: "apple iphone 15 pro max 512 gb",
                3: "apple iphone 15 pro max 1tb",
                4: "apple iphone 15 pro 128 gb",
                5: "apple iphone 15 pro 256 gb",
                6: 'apple iphone 15 128 gb',
                7: "apple iphone 15 256 gb",
                8: "apple iphone 14 pro max 128 gb",
                9: "apple iphone 14 pro max 256 gb",
                10: "apple iphone 14 pro max 512 gb",
                11: "apple iphone 14 pro max 1tb",
                12: 'apple iphone 14 pro 128 gb',
                13: 'apple iphone 14 pro 256 gb',
                14: 'apple iphone 14 pro 512 gb',
                15: 'apple iphone 14 pro 1 tb',
                16: 'Apple IPhone 14 Plus 128 gb',
                17: 'Apple IPhone 14 Plus 256 gb',
                18: "apple iphone 13 pro max 128 gb",
                19: "apple iphone 13 pro max 256 gb",
                20: "apple iphone 13 pro max 512 gb",
                21: "apple iphone 13 pro max 1 tb",
                22: 'apple iphone 13 pro 128 gb',
                23: 'apple iphone 13 pro 256 gb',
                24: 'apple iphone 13 128 gb',
                25: 'apple iphone 13 256 gb',
                26: "apple iphone 13 mini 256 gb",
                27: "apple iphone 12 pro max 128 gb",
                28: "apple iphone 12 pro max 256 gb",
                29: "apple iphone 12 pro max 512 gb",
                30: 'apple iphone 12 pro 128 gb',
                31: 'apple iphone 12 pro 256 gb',
                32: 'apple iphone 12 128 gb',
                33: 'apple iphone 12 64 gb',
                34: "apple iphone 11 pro max 256 gb",
                35: "apple iphone 11 pro max 64 gb",
                36: 'apple IPhone 11 Pro 256 gb',
                37: 'Apple IPhone 11 Pro  64 gb',
                38: 'Apple IPhone 11 256 gb',
                39: 'Apple IPhone 11 128 gb',
                40: 'Apple IPhone 11 64 gb',
                41: 'apple iphone xs max 256 gb',
                42: 'apple iphone xs max 64 gb',
                43: 'apple iphone xr 128 gb',
                44: 'apple iphone xr 64 gb',
                45: 'apple iphone xs 128 gb',
                46: 'apple iphone xs 64 gb',
                47: 'Apple IPhone X 64 GB',
                48: 'Apple IPhone X 256 GB',
                49: 'Apple IPhone 8 plus 256 gb',
                50: 'Apple IPhone 8 plus 64 gb',
                51: 'Apple IPhone 8 64 gb',
                52: 'Apple IPhone 8 256 gb',
                53: 'Apple IPhone 7 plus 128 gb',
                54: 'Apple IPhone 7 plus 32 gb',
                55: 'Apple IPhone 7 128 gb',
                56: 'Apple IPhone 7 32 gb',
            

                # Add other product names here
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

            iphone_table.append(entry)

    # Allow further testing by leaving the input part
    
    with open('IphoneJIJI.js', 'w') as js_file:
        js_file.write("export const iphoneTable = " + json.dumps(iphone_table, indent=2))

   

        

