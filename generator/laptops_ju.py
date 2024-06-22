import requests
import json
from bs4 import BeautifulSoup

def get_product_info(product_name):
    # Function to scrape Jumia search results for the given product_name
    base_url = 'https://www.jumia.com.ng/catalog/?q='
    search_url = base_url + product_name.replace(' ', '+')

    try:
        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        product_elements = soup.find_all('a', class_='core')

        if not product_elements:
            print(f"Product not available for '{product_name}'.")
            return {
                'first_three_lowest': [],
                'first_three_highest': []
            }

        product_data = []
        for element in product_elements:
            name_element = element.find('h3', class_='name')
            price_element = element.find('div', class_='prc')

            if name_element and price_element:
                # Special case for "apple iphone 13 6.1" 128gb"
                # Special case for "apple iphone 13 6.1" 128gb"
                if product_name in [
                    'HP 1040 G4',
                    'HP 250 G8',
                    'Hp PAVILION GAMING',
                    'HP SPECTRE X360',
                    'Dell Vostro 3510 Laptop',
                    'Asus E210MA INTEL CELERON',
                    'ASUS VIVOBOOK 14 core i3',
                    'Asus Zenbook UX325EA Core i7',
                    ]:
                    name_words = name_element.text.lower().split()[:3]
                    input_words = product_name.lower().split()[:3]

                elif product_name in [
                    'Apple MacBook Pro 16.2" M1 Max',
                    'HP ELITEBOOK 840 G5',
                    'HP ELITEBOOK 840 G8',
                    'HP ELITEBOOK 840 G9',
                    'HP OMEN 16 GAMING',
                    'HP PROBOOK 440 G8',
                    'HP PROBOOK 440 G9',
                    'Hp Spectre 14-ef0013dx',
                    'HP STREAM 11 PRO',
                    'HP 15 VICTUS GAMING,',
                    'Dell Inspiron 15 Touchscreen intel Core i5',
                    'DELL XPS 15 9530',
                    
                    ]:
                    name_words = name_element.text.lower().split()[:4]
                    input_words = product_name.lower().split()[:4]
                else:
                    name_words = name_element.text.lower().split()[:5]
                    input_words = product_name.lower().split()[:5]
                    

                # Check if the first four words match
                if name_words == input_words:
                    price = price_element.text.strip()
                    
                    product_data.append({'price': price})

        # Sort products by price
        sorted_products = sorted(product_data, key=lambda x: float(x['price'].replace('₦', '').replace(',', '')))

        # Extract the first three lowest and the first three highest
        first_three_lowest = sorted_products[:3]
        first_three_highest = sorted_products[-3:]

        return {
            'first_three_lowest': first_three_lowest,
            'first_three_highest': first_three_highest
        }

    except requests.RequestException as e:
        print(f"Error during the request: {e}")
        return None
    


# Rest of the code remains the same
def print_product_info(products, label):
    if products:
        print(f"\n{label} Product Information:")
        for product in products:
            print(f"Price: {product['price']}")
    else:
        print(f"\nProduct not Found.")


if __name__ == "__main__":
    
    product_names = [
         'APPLE MACBOOK PRO 2015',
         'APPLE MACBOOK PRO 2016',
         'APPLE MACBOOK PRO 2017 (13 inches)',
         'APPLE MACBOOK PRO 2017 (15 inches)',
         'Apple Refurbished MacBook Pro A1278 13" Intel I5, 4-512GB',
         'APPLE MACBOOK PRO INTEL 2018 (15 inches)',
         'Apple MacBook Pro 13.3" (2019) - Intel® Core™ I7, 2.8Ghz,512 GB SSD, 16GB RAM Silver',
         'APPLE MACBOOK PRO INTEL 2019 (15 inches)',
         'Apple MacBook Pro 13.3" (2020) - Intel® Core™ I5, 2.0Ghz,1 TB SSD, 16GB RAM Space Grey',
         'Apple 13.3" MacBook Pro M1 Chip 8GB/ 256GB (Late 2020)',
         'Apple MacBook Pro 16.2" M1 Max',
         'Apple MacBook Pro 14" M1 Pro Chip 16GB RAM,512GB(2021 Model)Silver',
         'Apple MacBook Pro 13.3" With M2 Chip 16GB RAM/1TB SSD - Space Grey',
         'Apple MacBook Pro 16" Laptop - M2 Max Chip - 32GB Memory - 1TB SSD Space Gray',
         'Apple MacBook Pro 16" Laptop - M2 Pro Chip - 16GB',
         'APPLE MACBOOK AIR 2015',
         'APPLE MACBOOK AIR 2017',
         'APPLE MACBOOK AIR 2018',
         'APPLE MACBOOK AIR 2019',
         'APPLE MACBOOK AIR INTEL 2020',
         'Apple MacBook Air 13" M1 Chip 8GB 256GB 2020 Model - Gray',
         'Apple MacBook Air 13-inch 2022 M2 / 8GB / 256GB SSD / 8-Core GPU / Space Gray',
         'Apple MacBook Air 15" Laptop - M2 Chip - 8GB Memory - 512GB SSD (Latest Model) - MIDNIGHT 2023',
         'HP 1040 G4',
         'HP 250 G8',
         'Hp ELITEBOOK X360 1030 G2 CORE I5',
         'Hp ELITEBOOK X360 1030 G3 8TH GEN TOUCH CORE I5',
         'HP ELITEBOOK 1040 G3',
         'HP ELITEBOOK 1040 G6',
         'HP ELITEBOOK 820 G3',
         'HP ELITEBOOK 830 G6',
         'HP ELITEBOOK 830 G8',
         'Hp EliteBook 840 G3-14" -Touchscreen-Core I5-8GB',
         'HP ELITEBOOK 840 G5',
         'HP ELITEBOOK 840 G8',
         'HP ELITEBOOK 840 G9',
         'HP ELITEBOOK 850 G8',
         'HP LAPTOP 15-DW1001NIA',
         'HP OMEN 16 GAMING',
         'Hp PAVILION GAMING',
         'Hp Pavilion X360 Convertible 14',
         'HP PROBOOK 440 G8',
         'HP PROBOOK 440 G9',
         'HP PROBOOK 450 G8',
         'HP PROBOOK 640 G8',
         'HP SPECTRE X360',
         'Hp Spectre 14-ef0013dx',
         'HP STREAM 11 PRO',
         'HP 15 VICTUS GAMING,',
         'HP ZBOOK G6',
         'HP ZBOOK G5',
         'ZED AIR H3',
         'Samsung Galaxy Book S',
         'MICROSOFT SURFACE PRO 9',
         'LENOVO IDEAPAD 3 15ITL6 laptop',
         'LENOVO IDEAPAD FLEX 5 SERIES 14ITL05',
         'LENOVO LEGION 7 SERIES 16ITHG6',
         'LENOVO THINKBOOK 15 G2-ITL 1135G7',
         'LENOVO THINKBOOK 15 G2-ITL 1165G7',
         'LENOVO THINKBOOK 15 IIL 1065G7',
         'LENOVO THINKPAD E14 Gen 4 1255U',
         'LENOVO THINKPAD E15 Gen 2 1135G7',
         'LENOVO THINKPAD E15 Gen 2 1165G7',
         'LENOVO THINKPAD X1 Carbon Gen 9',
         'LENOVO THINKPAD X1 TITANIUM YOGA Gen 1',
         'Lenovo v15-igl intel Celeron n4020/4gb ddr4/256gb/15.6" hd/Freedos',
         'LENOVO YOGA SLIM 7 14ITL05',
         'ACER Predator Helios 300 PH315-54-74FG Gaming Notebook (2023)',
         'ACER Predator Helios 300 PH315-55-70ZV Gaming Notebook (2023)',
         'ACER Predator Helios 300 PH315-55-795C Gaming Notebook (Late 2022)',
         'ACER Predator Triton 300 SE PT316-51s-7397 Gaming Notebook',
         'ACER Predator Triton 500 SE PT516-52s-99EL Gaming Notebook (2022)',
         'ALIENWARE M15 R5',
         'ASUS G14, ROG Zephyrus',
         'ASUS GAMING-FX506LH-HN0042W',
         'ASUS TUF DASH GAMING',
         'Asus Tuf Gaming F15 Fx506lhb-Hn324w Intel Ci5-10300h/16gb/512gb/Gtx 1650 Max q Graphics/Win 11/15.6" Fhd/Backlit Keyboard',
         'DELL G15',
         'HP OMEN 16 GAMING LAPTOP',
         'HP VICTUS GAMING LAPTOP',
         'MSI GE76 RAIDER',
         'MSI Katana GF66',
         'DELL G15',
         'Dell Inspiron 15 Touchscreen intel Core i5',
         'DELL LATITUDE 7300',
         'DELL LATITUDE 7410',
         'DELL LATITUDE 7420',
         'DELL PRECISION 5520', 
         'DELL VOSTRO 3400',
         'Dell Vostro 3510 Laptop',
         'DELL XPS 15 9530',
         'DELL XPS13 X360',
         'Asus E210MA INTEL CELERON',
         'ASUS E410MA-EK1015T',
         'ASUS GAMING-FX506LH-HN0042W',
         'ASUS TUF DASH GAMING',
         'ASUS TUF GAMING FX706IH-H7214T',
         'ASUS VIVOBOOK 14 core i3',
         'ASUS X515FA-EJ185W',
         'ASUS ZENBOOK 14 FLIP OLED',
         'Asus Zenbook UX325EA Core i7',    
         'Asus Zenbook 14 UX425EA Intel Core I5',
         'Asus Zenbook 14 UX425EA Intel Core I5',
         'ALIENWARE M15 R5',
        
    ]
    laptop_table = []

    for index, product_name in enumerate(product_names, start=1):
        print(f"\n*** Searching for '{product_name}' ***")
        results = get_product_info(product_name)

        # Extract prices and ensure there are at least three prices for highest and lowest
        prices_lowest = [float(product['price'].replace('₦', '').replace(',', '')) for product in results['first_three_lowest']]
        prices_lowest += [0.0] * (3 - len(prices_lowest))

        prices_highest = [float(product['price'].replace('₦', '').replace(',', '')) for product in results['first_three_highest']]
        prices_highest += [0.0] * (3 - len(prices_highest))

                # Assign specific product names based on the index
        assigned_product_name = {
        1: 'APPLE MACBOOK PRO 2015',
        2: 'APPLE MACBOOK PRO 2016',
        3: 'APPLE MACBOOK PRO 2017 (13 inches)',
        4: 'APPLE MACBOOK PRO 2017 (15 inches)',
        5: 'APPLE MACBOOK PRO INTEL 2018 (13 inches)',
        6: 'APPLE MACBOOK PRO INTEL 2018 (15 inches)',
        7: 'APPLE MACBOOK PRO INTEL 2019 (13 inches)',
        8: 'APPLE MACBOOK PRO INTEL 2019 (15 inches)',
        9: 'APPLE MACBOOK PRO INTEL 2020',
        10: 'APPLE MACBOOK PRO M1 2020',
        11: 'APPLE MACBOOK PRO M1 MAX 2021',
        12: 'APPLE MACBOOK PRO M1 PRO 2021',
        13: 'APPLE MACBOOK PRO M2 2022',
        14: 'APPLE MACBOOK PRO M2 MAX 2023',
        15: 'APPLE MACBOOK PRO M2 PRO 2023',
        16: 'APPLE MACBOOK AIR 2015',
        17: 'APPLE MACBOOK AIR 2017',
        18: 'APPLE MACBOOK AIR 2018',
        19: 'APPLE MACBOOK AIR 2019',
        20: 'APPLE MACBOOK AIR INTEL 2020',
        21: 'APPLE MACBOOK AIR M1 2020',
        22: 'APPLE MACBOOK AIR M2 2022',
        23: 'APPLE MACBOOK AIR M2 2023',
        24: 'HP 1040 G4',
        25: 'HP 250 G8',
        26: 'HP ELITEBOOK 1030 G2',
        27: 'HP ELITEBOOK 1030 G3',
        28: 'HP ELITEBOOK 1040 G3',
        29: 'HP ELITEBOOK 1040 G6',
        30: 'HP ELITEBOOK 820 G3',
        31: 'HP ELITEBOOK 830 G6',
        32: 'HP ELITEBOOK 830 G8',
        33: 'HP ELITEBOOK 840 G3',
        34: 'HP ELITEBOOK 840 G5',
        35: 'HP ELITEBOOK 840 G8',
        36: 'HP ELITEBOOK 840 G9',
        37: 'HP ELITEBOOK 850 G8',
        38: 'HP LAPTOP 15-DW1001NIA',
        39: 'HP OMEN 16 GAMING LAPTOP',
        40: 'HP PAVILION',
        41: 'HP PAVILION X360 CONVERTIBLE 14-DY1094NIA',
        42: 'HP PROBOOK 440 G8',
        43: 'HP PROBOOK 440 G9',
        44: 'HP PROBOOK 450 G8',
        45: 'HP PROBOOK 640 G8',
        46: 'HP SPECTRE X360',
        47: 'HP SPECTRE X360 14-EA0133NA LAPTOP',
        48: 'HP STREAM 11 PRO',
        49: 'HP VICTUS GAMING LAPTOP',
        50: 'HP ZBOOK G6',
        51: 'HP ZBOOK G5',
        52: 'ZED AIR H3',
        53: 'Samsung Galaxy Book S',
        54: 'MICROSOFT SURFACE PRO 9',
        55: 'LENOVO IDEAPAD 3 15ITL6',
        56: 'LENOVO IDEAPAD FLEX 5 SERIES 14ITL05',
        57: 'LENOVO LEGION 7 SERIES 16ITHG6',
        58: 'LENOVO THINKBOOK 15 G2-ITL 1135G7',
        59: 'LENOVO THINKBOOK 15 G2-ITL 1165G7',
        60: 'LENOVO THINKBOOK 15 IIL 1065G7',
        61: 'LENOVO THINKPAD E14 Gen 4 1255U',
        62: 'LENOVO THINKPAD E15 Gen 2 1135G7',
        63: 'LENOVO THINKPAD E15 Gen 2 1165G7',
        64: 'LENOVO THINKPAD X1 Carbon Gen 9',
        65: 'LENOVO THINKPAD X1 TITANIUM YOGA Gen 1',
        66: 'LENOVO V15-IGL',
        67: 'LENOVO YOGA SLIM 7 14ITL05',
        68: 'ACER Predator Helios 300 PH315-54-74FG Gaming Notebook (2023)',
        69: 'ACER Predator Helios 300 PH315-55-70ZV Gaming Notebook (2023)',
        70: 'ACER Predator Helios 300 PH315-55-795C Gaming Notebook (Late 2022)',
        71: 'ACER Predator Triton 300 SE PT316-51s-7397 Gaming Notebook',
        72: 'ACER Predator Triton 500 SE PT516-52s-99EL Gaming Notebook (2022)',
        73: 'ALIENWARE M15 R5',
        74: 'ASUS G14, ROG Zephyrus',
        75: 'ASUS GAMING-FX506LH-HN0042W',
        76: 'ASUS TUF DASH GAMING',
        77: 'ASUS TUF GAMING FX706IH-H7214T',
        78: 'DELL G15',
        79: 'HP OMEN 16 GAMING LAPTOP',
        80: 'HP VICTUS GAMING LAPTOP',
        81: 'MSI GE76 RAIDER',
        82: 'MSI Katana GF66',
        83: 'DELL G15',
        84: 'DELL INSPIRON 15-3511',
        85: 'DELL LATITUDE 7300',
        86: 'DELL LATITUDE 7410',
        87: 'DELL LATITUDE 7420',
        88: 'DELL PRECISION 5520', 
        89: 'DELL VOSTRO 3400',
        90: 'DELL VOSTRO 3510',
        91: 'DELL XPS 15 9530',
        92: 'DELL XPS13 X360',
        93: 'ASUS E210MA-GJ068T',
        94: 'ASUS E410MA-EK1015T',
        95: 'ASUS GAMING-FX506LH-HN0042W',
        96: 'ASUS TUF DASH GAMING',
        97: 'ASUS TUF GAMING FX706IH-H7214T',
        98: 'ASUS VIVOBOOK',
        99: 'ASUS X515FA-EJ185W',
        101: 'ASUS ZENBOOK 14 FLIP OLED',
        102: 'ASUS ZENBOOK- UX325EA-KG333T',    
        103: 'ASUS ZENBOOK- UX425EA-KI464T',
        104: 'ASUS ZENBOOK- UX425EA-KI979W',
        105: 'ALIENWARE M15 R5',
            

            # Add other product names here
        }.get(index, f"Unknown Product {index}")
    # Constructing the JavaScript format
        entry = {
            'id': index,
            'Pname': assigned_product_name,
            'Link': f"https://www.jumia.com.ng/catalog/?q={product_name.replace(' ', '+')}",
            'H1': f"{prices_highest[0]:,.0f}",
            'H2': f"{prices_highest[1]:,.0f}",
            'H3': f"{prices_highest[2]:,.0f}",
            'L1': f"{prices_lowest[0]:,.0f}",
            'L2': f"{prices_lowest[1]:,.0f}",
            'L3': f"{prices_lowest[2]:,.0f}",
        }

        laptop_table.append(entry)

    with open('laptopJUMIA.js', 'w') as js_file:
        js_file.write("export const laptopTable = " + json.dumps(laptop_table, indent=2))